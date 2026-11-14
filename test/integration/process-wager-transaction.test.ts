import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { IdempotencyConflictError, WalletPlayerMismatchError } from "../../src/application/wagering/wagering.errors.ts";
import {
  ProcessWagerTransactionUseCase,
  type WagerTransactionResult,
} from "../../src/application/wagering/process-wager-transaction.use-case.ts";
import { CreateWalletUseCase } from "../../src/application/wallet/create-wallet.use-case.ts";
import { WalletNotFoundError } from "../../src/application/wallet/wallet.errors.ts";
import { CurrencyMismatchError } from "../../src/domain/money/money.errors.ts";
import { Money } from "../../src/domain/money/money.ts";
import { FailureCode } from "../../src/domain/wager-transaction/failure-code.ts";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/wager-transaction/wager-transaction.enums.ts";
import type { WagerTransactionInput } from "../../src/http/wager-transaction.request.ts";
import { startTestApp, type TestApp } from "./support/app.ts";
import { closeTestOrm, sql } from "./support/database.ts";
import { assertLedgerMatchesBalance } from "./support/ledger.ts";
import { newId } from "./support/rows.ts";

/**
 * O ProcessWagerTransactionUseCase contra o Postgres REAL.
 *
 * Por que integração e não unitário: o que interessa aqui é justamente o que só
 * o banco faz — o lock da wallet (FOR UPDATE), os UNIQUEs da idempotência, as FKs,
 * a transação SQL que grava tudo ou nada. Um mock esconderia exatamente isso.
 *
 * Isolamento: cada teste cria a SUA wallet (UUID novo), então os testes não se
 * enxergam e não precisam apagar o banco entre um e outro.
 */

const { Bet, Win, Loss, Refund, Rollback } = WagerTransactionKind;
const { Processed, Rejected, PendingReference } = WagerTransactionStatus;

let api: TestApp;
let useCase: ProcessWagerTransactionUseCase;
let createWallet: CreateWalletUseCase;

beforeAll(async () => {
  api = await startTestApp();
  // Pega as instâncias que o Nest montou — as mesmas que o controller vai usar.
  useCase = api.app.get(ProcessWagerTransactionUseCase);
  createWallet = api.app.get(CreateWalletUseCase);
});
afterAll(async () => {
  await api.close();
  await closeTestOrm();
});

// ============================================================================ helpers

const PROVIDER = "provider-a";
const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

interface TestWallet {
  walletId: string;
  playerId: string;
}

/** Cria uma wallet nova (com OPENING + lançamento inicial, igual produção). */
async function newWallet(amount = "100.00"): Promise<TestWallet> {
  const playerId = newId();
  const wallet = await createWallet.execute({ playerId, initialBalance: brl(amount) });
  return { walletId: wallet.id, playerId };
}

/** Monta um pedido válido. Cada chamada gera um externalTransactionId novo. */
function request(
  wallet: TestWallet,
  kind: WagerTransactionKind,
  amount: string,
  overrides: Partial<WagerTransactionInput> = {},
): WagerTransactionInput {
  const externalTransactionId = overrides.externalTransactionId ?? `tx-${newId()}`;
  return {
    providerId: PROVIDER,
    externalTransactionId,
    idempotencyKey: `${PROVIDER}:${externalTransactionId}`,
    playerId: wallet.playerId,
    walletId: wallet.walletId,
    roundId: "round-1",
    gameId: "game-1",
    kind,
    money: brl(amount),
    referenceExternalTransactionId: undefined,
    ...overrides,
  };
}

/** Atalho para uma reversão (REFUND/ROLLBACK) apontando para um pedido anterior. */
const reversal = (
  wallet: TestWallet,
  kind: WagerTransactionKind,
  of: WagerTransactionInput,
  overrides: Partial<WagerTransactionInput> = {},
) =>
  request(wallet, kind, of.money.toJSON().amount, {
    referenceExternalTransactionId: of.externalTransactionId,
    ...overrides,
  });

async function walletRow(walletId: string) {
  const [row] = await sql("select balance_amount, version from wallets where id = ?", [walletId]);
  return row as { balance_amount: string; version: number };
}

async function transactionRow(transactionId: string) {
  const [row] = await sql("select * from wager_transactions where id = ?", [transactionId]);
  return row;
}

/** Lançamentos de wager (ignora o do OPENING, que toda wallet com saldo tem). */
async function wagerLedgerEntries(walletId: string) {
  return sql(
    `select l.direction, l.amount, l.balance_before_amount, l.balance_after_amount, l.transaction_id
       from wallet_ledger_entries l
       join wager_transactions t on t.id = l.transaction_id
      where l.wallet_id = ? and t.kind <> 'OPENING'
      order by l.id`,
    [walletId],
  );
}

async function countTransactions(walletId: string): Promise<number> {
  const [row] = await sql("select count(*)::int as n from wager_transactions where wallet_id = ? and kind <> 'OPENING'", [walletId]);
  return row.n;
}

/** Espera o erro e devolve ele (para checar o tipo e os campos). */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("era esperado um erro, mas a promise resolveu");
}

// ============================================================================ BET

describe("BET", () => {
  test("BET 30.00 numa wallet de 100.00 → PROCESSED, saldo 70.00, lançamento DEBIT 100 → 70", async () => {
    const wallet = await newWallet("100.00");

    const result = await useCase.execute(request(wallet, Bet, "30.00"));

    expect(result).toEqual({
      transactionId: expect.any(String),
      status: Processed,
      balance: { amount: "70.00", currency: "BRL" },
      idempotentReplay: false,
    });

    const row = await transactionRow(result.transactionId);
    expect(row.status).toBe(Processed);
    expect(row.balance_after_amount).toBe("70.00");
    expect(row.processed_at).not.toBeNull();
    expect(row.failure_code).toBeNull();

    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "70.00", version: 2 });
    expect(await wagerLedgerEntries(wallet.walletId)).toEqual([
      {
        direction: "DEBIT",
        amount: "30.00",
        balance_before_amount: "100.00",
        balance_after_amount: "70.00",
        transaction_id: result.transactionId,
      },
    ]);
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("BET do saldo inteiro → PROCESSED, saldo 0.00", async () => {
    const wallet = await newWallet("100.00");

    const result = await useCase.execute(request(wallet, Bet, "100.00"));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("0.00");
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("BET maior que o saldo → REJECTED INSUFFICIENT_FUNDS, GRAVADA, saldo e ledger intactos", async () => {
    const wallet = await newWallet("100.00");

    const result = await useCase.execute(request(wallet, Bet, "100.01"));

    expect(result).toEqual({
      transactionId: expect.any(String),
      status: Rejected,
      balance: { amount: "100.00", currency: "BRL" },
      idempotentReplay: false,
      failureCode: FailureCode.InsufficientFunds,
    });

    // Rejeição é resultado, não exceção: a linha existe para auditoria e replay.
    const row = await transactionRow(result.transactionId);
    expect(row.status).toBe(Rejected);
    expect(row.failure_code).toBe(FailureCode.InsufficientFunds);
    expect(row.balance_after_amount).toBeNull();

    // A wallet não foi tocada: nem saldo, nem versão.
    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "100.00", version: 1 });
    expect(await wagerLedgerEntries(wallet.walletId)).toEqual([]);
    await assertLedgerMatchesBalance(wallet.walletId);
  });
});

// ============================================================================ WIN e LOSS

describe("WIN e LOSS", () => {
  test("WIN 50.00 → PROCESSED, saldo 150.00, lançamento CREDIT 100 → 150", async () => {
    const wallet = await newWallet("100.00");

    const result = await useCase.execute(request(wallet, Win, "50.00"));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("150.00");
    expect(await wagerLedgerEntries(wallet.walletId)).toEqual([
      expect.objectContaining({ direction: "CREDIT", balance_before_amount: "100.00", balance_after_amount: "150.00" }),
    ]);
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("LOSS 0.00 → PROCESSED, saldo igual, SEM lançamento e SEM mudar a versão", async () => {
    const wallet = await newWallet("100.00");

    const result = await useCase.execute(request(wallet, Loss, "0.00"));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("100.00");

    const row = await transactionRow(result.transactionId);
    expect(row.status).toBe(Processed);
    expect(row.balance_after_amount).toBe("100.00"); // o CHECK exige saldo em toda PROCESSED

    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "100.00", version: 1 });
    expect(await wagerLedgerEntries(wallet.walletId)).toEqual([]);
  });

  test("LOSS com valor (registro da aposta perdida) também não move saldo", async () => {
    const wallet = await newWallet("100.00");

    const result = await useCase.execute(request(wallet, Loss, "25.00"));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("100.00");
    expect(await wagerLedgerEntries(wallet.walletId)).toEqual([]);
  });

  test("rodada completa: BET 25 → WIN 60 → saldo 135.00, ledger fecha", async () => {
    const wallet = await newWallet("100.00");

    await useCase.execute(request(wallet, Bet, "25.00"));
    const win = await useCase.execute(request(wallet, Win, "60.00"));

    expect(win.balance.amount).toBe("135.00");
    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "135.00", version: 3 });
    await assertLedgerMatchesBalance(wallet.walletId);
  });
});

// ============================================================================ REFUND

describe("REFUND", () => {
  test("REFUND de uma BET → PROCESSED, devolve o valor e liga as duas transações", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");
    const betResult = await useCase.execute(bet);

    const result = await useCase.execute(reversal(wallet, Refund, bet));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("100.00");

    // A ligação pelo id INTERNO é o que o UNIQUE parcial e a FK usam.
    const row = await transactionRow(result.transactionId);
    expect(row.reference_transaction_id).toBe(betResult.transactionId);

    expect((await wagerLedgerEntries(wallet.walletId)).map((e) => e.direction)).toEqual(["DEBIT", "CREDIT"]);
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("REFUND antes da BET chegar → PENDING_REFERENCE agendado para ~1s, sem mexer no saldo", async () => {
    const wallet = await newWallet("100.00");
    const before = Date.now();

    const result = await useCase.execute(
      request(wallet, Refund, "25.00", { referenceExternalTransactionId: "bet-que-ainda-nao-chegou" }),
    );

    expect(result).toEqual({
      transactionId: expect.any(String),
      status: PendingReference,
      balance: { amount: "100.00", currency: "BRL" },
      idempotentReplay: false,
    });

    const row = await transactionRow(result.transactionId);
    expect(row.status).toBe(PendingReference);
    expect(row.reference_transaction_id).toBeNull();
    // Agendado para o futuro (o worker do dia 3 tenta de novo quando chegar a hora).
    const nextAttemptAt = new Date(row.next_attempt_at).getTime();
    expect(nextAttemptAt).toBeGreaterThanOrEqual(before + 900);
    expect(nextAttemptAt).toBeLessThanOrEqual(Date.now() + 1100);

    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "100.00", version: 1 });
  });

  test("segundo REFUND da mesma BET (outro externalId) → REJECTED ALREADY_REVERSED", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");
    await useCase.execute(bet);
    await useCase.execute(reversal(wallet, Refund, bet));

    const second = await useCase.execute(reversal(wallet, Refund, bet));

    expect(second.status).toBe(Rejected);
    expect(second.failureCode).toBe(FailureCode.AlreadyReversed);
    expect(second.balance.amount).toBe("100.00"); // não devolveu duas vezes
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("REFUND com valor diferente da BET → REJECTED AMOUNT_MISMATCH", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");
    await useCase.execute(bet);

    const result = await useCase.execute(reversal(wallet, Refund, bet, { money: brl("30.00") }));

    expect(result.status).toBe(Rejected);
    expect(result.failureCode).toBe(FailureCode.AmountMismatch);
    expect(result.balance.amount).toBe("75.00");
  });

  test("REFUND de uma BET REJEITADA → REJECTED REFERENCE_NOT_PROCESSED (não cria dinheiro do nada)", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "500.00"); // sem saldo → REJECTED
    await useCase.execute(bet);

    const result = await useCase.execute(reversal(wallet, Refund, bet));

    expect(result.status).toBe(Rejected);
    expect(result.failureCode).toBe(FailureCode.ReferenceNotProcessed);
    expect(result.balance.amount).toBe("100.00");
  });

  test("REFUND de um WIN → REJECTED INVALID_REFERENCE_KIND", async () => {
    const wallet = await newWallet("100.00");
    const win = request(wallet, Win, "50.00");
    await useCase.execute(win);

    const result = await useCase.execute(reversal(wallet, Refund, win));

    expect(result.failureCode).toBe(FailureCode.InvalidReferenceKind);
    expect(result.balance.amount).toBe("150.00");
  });

  test("REFUND na wallet da Maria apontando para a BET do João → REJECTED REFERENCE_MISMATCH", async () => {
    const joao = await newWallet("100.00");
    const maria = await newWallet("100.00");
    const betDoJoao = request(joao, Bet, "25.00");
    await useCase.execute(betDoJoao);

    const result = await useCase.execute(reversal(maria, Refund, betDoJoao));

    expect(result.status).toBe(Rejected);
    expect(result.failureCode).toBe(FailureCode.ReferenceMismatch);
    expect((await walletRow(maria.walletId)).balance_amount).toBe("100.00");
    expect((await walletRow(joao.walletId)).balance_amount).toBe("75.00");
  });
});

// ============================================================================ ROLLBACK

describe("ROLLBACK", () => {
  test("ROLLBACK de uma BET → credita de volta", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "40.00");
    await useCase.execute(bet);

    const result = await useCase.execute(reversal(wallet, Rollback, bet));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("100.00");
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("ROLLBACK de um WIN → DEBITA (inverte a direção da referência)", async () => {
    const wallet = await newWallet("100.00");
    const win = request(wallet, Win, "50.00");
    await useCase.execute(win);

    const result = await useCase.execute(reversal(wallet, Rollback, win));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("100.00");
    expect((await wagerLedgerEntries(wallet.walletId)).map((e) => e.direction)).toEqual(["CREDIT", "DEBIT"]);
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("ROLLBACK de um WIN sem saldo para desfazer → REJECTED REVERSAL_INSUFFICIENT_FUNDS", async () => {
    const wallet = await newWallet("100.00");
    const win = request(wallet, Win, "50.00");
    await useCase.execute(win); // 150
    await useCase.execute(request(wallet, Bet, "140.00")); // 10

    const result = await useCase.execute(reversal(wallet, Rollback, win));

    expect(result.status).toBe(Rejected);
    // Código PRÓPRIO de reversão: quem consulta sabe que foi o rollback, não uma aposta.
    expect(result.failureCode).toBe(FailureCode.ReversalInsufficientFunds);
    expect(result.balance.amount).toBe("10.00");
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("ROLLBACK de uma LOSS → REJECTED INVALID_REFERENCE_KIND (e não um erro 500)", async () => {
    const wallet = await newWallet("100.00");
    // LOSS com valor: o ROLLBACK copia o valor, e reversão de 0.00 o domínio nem aceita.
    const loss = request(wallet, Loss, "25.00");
    await useCase.execute(loss);

    const result = await useCase.execute(reversal(wallet, Rollback, loss));

    expect(result.status).toBe(Rejected);
    expect(result.failureCode).toBe(FailureCode.InvalidReferenceKind);
  });

  test("REFUND seguido de ROLLBACK da MESMA BET → ALREADY_REVERSED (não devolve duas vezes)", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");
    await useCase.execute(bet); // 75
    await useCase.execute(reversal(wallet, Refund, bet)); // 100

    const rollback = await useCase.execute(reversal(wallet, Rollback, bet));

    expect(rollback.status).toBe(Rejected);
    expect(rollback.failureCode).toBe(FailureCode.AlreadyReversed);
    expect(rollback.balance.amount).toBe("100.00"); // e não 125.00
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("ROLLBACK seguido de REFUND da MESMA BET → ALREADY_REVERSED", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");
    await useCase.execute(bet);
    await useCase.execute(reversal(wallet, Rollback, bet));

    const refund = await useCase.execute(reversal(wallet, Refund, bet));

    expect(refund.failureCode).toBe(FailureCode.AlreadyReversed);
    expect(refund.balance.amount).toBe("100.00");
  });

  test("ROLLBACK de um REFUND continua permitido (é outra transação sendo revertida)", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");
    await useCase.execute(bet); // 75
    const refund = reversal(wallet, Refund, bet);
    await useCase.execute(refund); // 100

    const result = await useCase.execute(reversal(wallet, Rollback, refund));

    expect(result.status).toBe(Processed);
    expect(result.balance.amount).toBe("75.00"); // desfez o reembolso
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("ROLLBACK duplicado → ALREADY_REVERSED", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");
    await useCase.execute(bet);
    await useCase.execute(reversal(wallet, Rollback, bet));

    const second = await useCase.execute(reversal(wallet, Rollback, bet));

    expect(second.failureCode).toBe(FailureCode.AlreadyReversed);
    await assertLedgerMatchesBalance(wallet.walletId);
  });
});

// ============================================================================ idempotência

describe("idempotência", () => {
  test("mesmo pedido duas vezes → replay: mesmo id, mesmo saldo, UMA linha e UM lançamento", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "30.00");

    const first = await useCase.execute(bet);
    const second = await useCase.execute(bet);

    expect(second).toEqual({ ...first, idempotentReplay: true });
    expect(await countTransactions(wallet.walletId)).toBe(1);
    expect(await wagerLedgerEntries(wallet.walletId)).toHaveLength(1);
    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "70.00", version: 2 });
  });

  test("replay devolve o saldo DA ÉPOCA, mesmo que a wallet tenha mudado depois", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "30.00");
    await useCase.execute(bet); // 70
    await useCase.execute(request(wallet, Bet, "10.00")); // 60

    const replay = await useCase.execute(bet);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.balance.amount).toBe("70.00");
  });

  test("replay de uma REJEITADA continua REJEITADA (mesmo que agora tivesse saldo)", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "150.00");
    const first = await useCase.execute(bet);
    await useCase.execute(request(wallet, Win, "100.00")); // agora teria saldo

    const replay = await useCase.execute(bet);

    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.status).toBe(Rejected);
    expect(replay.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(replay.idempotentReplay).toBe(true);
    expect(await countTransactions(wallet.walletId)).toBe(2); // a BET e o WIN, nada novo
  });

  test("'30' e '30.00' são o mesmo payload → replay, não conflito", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "30.00");
    await useCase.execute(bet);

    const replay = await useCase.execute({ ...bet, money: brl("30") });

    expect(replay.idempotentReplay).toBe(true);
  });

  test("mesma Idempotency-Key com valor diferente → IdempotencyConflictError, nada gravado", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "30.00");
    const first = await useCase.execute(bet);

    const error = await errorOf(useCase.execute({ ...bet, money: brl("31.00") }));

    expect(error).toBeInstanceOf(IdempotencyConflictError);
    expect((error as IdempotencyConflictError).existingTransactionId).toBe(first.transactionId);
    expect(await countTransactions(wallet.walletId)).toBe(1);
    expect((await walletRow(wallet.walletId)).balance_amount).toBe("70.00");
  });

  test("mesmo externalTransactionId com OUTRA key → IdempotencyConflictError", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "30.00");
    await useCase.execute(bet);

    const error = await errorOf(useCase.execute({ ...bet, idempotencyKey: `outra-key-${newId()}` }));

    expect(error).toBeInstanceOf(IdempotencyConflictError);
    expect(await countTransactions(wallet.walletId)).toBe(1);
  });

  test("a mesma key em providers diferentes NÃO conflita (o escopo é por provider)", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "10.00");
    await useCase.execute(bet);

    const other = await useCase.execute({ ...bet, providerId: "provider-b" });

    expect(other.idempotentReplay).toBe(false);
    expect(other.balance.amount).toBe("80.00");
  });
});

// ============================================================================ erros (nada é gravado)

describe("pedidos inválidos → exceção e NADA gravado", () => {
  test("wallet inexistente → WalletNotFoundError", async () => {
    const ghost = { walletId: newId(), playerId: newId() };
    const bet = request(ghost, Bet, "10.00");

    const error = await errorOf(useCase.execute(bet));

    expect(error).toBeInstanceOf(WalletNotFoundError);
    expect(await sql("select 1 from wager_transactions where external_transaction_id = ?", [bet.externalTransactionId])).toEqual([]);
  });

  test("player que não é dono da wallet → WalletPlayerMismatchError", async () => {
    const wallet = await newWallet("100.00");

    const error = await errorOf(useCase.execute(request(wallet, Bet, "10.00", { playerId: newId() })));

    expect(error).toBeInstanceOf(WalletPlayerMismatchError);
    expect((error as WalletPlayerMismatchError).walletId).toBe(wallet.walletId);
    expect(await countTransactions(wallet.walletId)).toBe(0);
  });

  test("moeda diferente da wallet → CurrencyMismatchError", async () => {
    const wallet = await newWallet("100.00");
    const usd = Money.from({ amount: "10.00", currency: "USD" });

    const error = await errorOf(useCase.execute(request(wallet, Bet, "10.00", { money: usd })));

    expect(error).toBeInstanceOf(CurrencyMismatchError);
    expect(await countTransactions(wallet.walletId)).toBe(0);
    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "100.00", version: 1 });
  });
});

// ============================================================================ concorrência

describe("concorrência (o lock da wallet em ação)", () => {
  test("duas BETs de 80.00 AO MESMO TEMPO numa wallet de 100.00 → uma passa, a outra é rejeitada", async () => {
    const wallet = await newWallet("100.00");

    const results = await Promise.all([
      useCase.execute(request(wallet, Bet, "80.00")),
      useCase.execute(request(wallet, Bet, "80.00")),
    ]);

    // Sem o FOR UPDATE, as duas leriam saldo 100 e o saldo terminaria em -60 (ou o CHECK estouraria).
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([Processed, Rejected]);
    expect(results.find((r) => r.status === Rejected)!.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "20.00", version: 2 });
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("50 cópias do MESMO pedido em paralelo → 1 processada + 49 replays, debitado uma vez só", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "30.00");

    const results = await Promise.all(Array.from({ length: 50 }, () => useCase.execute(bet)));

    expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    expect(results.filter((r) => r.idempotentReplay)).toHaveLength(49);
    // Todas as 50 respostas falam da MESMA transação e do MESMO saldo.
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(results.every((r) => r.balance.amount === "70.00")).toBe(true);

    expect(await countTransactions(wallet.walletId)).toBe(1);
    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "70.00", version: 2 });
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("20 BETs DIFERENTES de 10.00 em paralelo numa wallet de 100.00 → 10 passam, 10 rejeitadas, saldo 0.00", async () => {
    const wallet = await newWallet("100.00");

    const results: WagerTransactionResult[] = await Promise.all(
      Array.from({ length: 20 }, () => useCase.execute(request(wallet, Bet, "10.00"))),
    );

    expect(results.filter((r) => r.status === Processed)).toHaveLength(10);
    expect(results.filter((r) => r.status === Rejected)).toHaveLength(10);
    expect(await walletRow(wallet.walletId)).toEqual({ balance_amount: "0.00", version: 11 });
    // A corrente do ledger prova que nenhum débito "leu" um saldo velho.
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("BET e REFUND dela chegando JUNTOS → no fim o saldo volta a 100.00 ou o REFUND fica pendente", async () => {
    const wallet = await newWallet("100.00");
    const bet = request(wallet, Bet, "25.00");

    const [, refund] = await Promise.all([
      useCase.execute(bet),
      useCase.execute(reversal(wallet, Refund, bet)),
    ]);

    // Depende de quem pega o lock primeiro — os dois finais são corretos.
    const { balance_amount } = await walletRow(wallet.walletId);
    if (refund.status === Processed) expect(balance_amount).toBe("100.00");
    else {
      expect(refund.status).toBe(PendingReference);
      expect(balance_amount).toBe("75.00");
    }
    await assertLedgerMatchesBalance(wallet.walletId);
  });

  test("a MESMA key em wallets DIFERENTES ao mesmo tempo → uma grava, a outra é conflito (caminho do retry)", async () => {
    const a = await newWallet("100.00");
    const b = await newWallet("100.00");
    const externalTransactionId = `tx-${newId()}`;

    // Locks diferentes (uma wallet cada) → não serializam. Os dois podem passar
    // pela busca da key, e o 2º INSERT bate no UNIQUE. O retry resolve virando conflito.
    const outcomes = await Promise.allSettled([
      useCase.execute(request(a, Bet, "10.00", { externalTransactionId })),
      useCase.execute(request(b, Bet, "10.00", { externalTransactionId })),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(IdempotencyConflictError);

    const balances = [(await walletRow(a.walletId)).balance_amount, (await walletRow(b.walletId)).balance_amount].sort();
    expect(balances).toEqual(["100.00", "90.00"]);
  });
});
