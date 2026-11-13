import { describe, expect, test } from "bun:test";
import { WagerTransaction, type CreateWagerTransactionProps, type WagerTransactionState } from "./wager-transaction.ts";
import { WagerTransactionKind, WagerTransactionStatus } from "./wager-transaction.enums.ts";
import { FailureCode } from "./failure-code.ts";
import {
  InvalidTransactionStateError,
  LedgerDirectionUnavailableError,
  MissingReferenceError,
  UnexpectedReferenceError,
} from "./wager-transaction.errors.ts";
import { LedgerDirection } from "../ledger/ledger-direction.ts";
import { Money } from "../money/money.ts";
import { InvalidAmountError } from "../wallet/wallet.errors.ts";

const { Opening, Bet, Win, Loss, Refund, Rollback } = WagerTransactionKind;
const { Pending, PendingReference, Processed, Rejected, Failed } = WagerTransactionStatus;

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const PAST = new Date("2026-01-01T00:00:00.000Z");

/** Props de uma BET válida. Cada teste troca só o que precisa. */
const validProps = (overrides: Partial<CreateWagerTransactionProps> = {}): CreateWagerTransactionProps => ({
  id: "tx-internal-1",
  providerId: "provider-a",
  externalTransactionId: "transaction-123",
  idempotencyKey: "provider-a:transaction-123",
  payloadHash: "hash-abc",
  walletId: "wallet-1",
  playerId: "player-1",
  roundId: "round-987",
  gameId: "fortune-chimp",
  kind: Bet,
  money: brl("25.00"),
  referenceExternalTransactionId: undefined,
  ...overrides,
});

/** Atalho para criar transações que exigem referência (REFUND/ROLLBACK). */
const withReference = (kind: WagerTransactionKind, overrides: Partial<CreateWagerTransactionProps> = {}) =>
  WagerTransaction.create(validProps({ kind, referenceExternalTransactionId: "transaction-100", ...overrides }));

/** Transação "vinda do banco" já em um status específico. */
const rehydrated = (status: WagerTransactionStatus, overrides: Partial<WagerTransactionState> = {}) =>
  WagerTransaction.rehydrate({ ...validProps(), createdAt: PAST, status, ...overrides });

// =====================================================================================
// PARTE 1
// =====================================================================================

describe("WagerTransaction.create", () => {
  test("BET válida nasce PENDING, com createdAt e sem failureCode/processedAt/referência", () => {
    const tx = WagerTransaction.create(validProps());

    expect(tx.status).toBe(Pending);
    expect(tx.kind).toBe(Bet);
    expect(tx.money.equals(brl("25.00"))).toBe(true);
    expect(tx.createdAt).toBeInstanceOf(Date);
    expect(tx.failureCode).toBeUndefined();
    expect(tx.processedAt).toBeUndefined();
    expect(tx.referenceTransactionId).toBeUndefined();
  });

  test.each([[Refund], [Rollback]])("%s sem referência → MissingReferenceError", (kind) => {
    expect(() => WagerTransaction.create(validProps({ kind }))).toThrow(MissingReferenceError);
  });

  test.each([[Refund], [Rollback]])("%s com referência string vazia → MissingReferenceError", (kind) => {
    expect(() =>
      WagerTransaction.create(validProps({ kind, referenceExternalTransactionId: "" })),
    ).toThrow(MissingReferenceError);
  });

  test.each([[Refund], [Rollback]])("%s com referência → cria", (kind) => {
    const tx = withReference(kind);
    expect(tx.status).toBe(Pending);
    expect(tx.referenceExternalTransactionId).toBe("transaction-100");
  });

  test("BET com referência → UnexpectedReferenceError", () => {
    expect(() =>
      WagerTransaction.create(validProps({ referenceExternalTransactionId: "transaction-100" })),
    ).toThrow(UnexpectedReferenceError);
  });

  test("WIN com e sem referência → cria", () => {
    expect(WagerTransaction.create(validProps({ kind: Win })).status).toBe(Pending);
    expect(withReference(Win).status).toBe(Pending);
  });

  test.each([[Bet], [Win], [Refund], [Rollback], [Opening]])("%s com valor 0.00 → InvalidAmountError", (kind) => {
    const props = validProps({ kind, money: brl("0.00") });
    if (kind === Refund || kind === Rollback) props.referenceExternalTransactionId = "transaction-100";
    expect(() => WagerTransaction.create(props)).toThrow(InvalidAmountError);
  });

  test("LOSS com valor 0.00 → cria (perder não move dinheiro)", () => {
    const tx = WagerTransaction.create(validProps({ kind: Loss, money: brl("0.00") }));
    expect(tx.status).toBe(Pending);
  });

  test("LOSS com valor negativo → InvalidAmountError (zero sim, negativo não)", () => {
    const negative = Money.zero("BRL").subtract(brl("10.00"));
    expect(() => WagerTransaction.create(validProps({ kind: Loss, money: negative }))).toThrow(InvalidAmountError);
  });

  test("OPENING → cria (o domínio aceita; quem bloqueia o OPENING externo é a API/fila)", () => {
    const tx = WagerTransaction.create(validProps({ kind: Opening, money: brl("1000.00") }));
    expect(tx.kind).toBe(Opening);
  });
});

describe("WagerTransaction.rehydrate", () => {
  test("reconstrói uma transação REJECTED com failureCode, sem lançar erro", () => {
    const tx = rehydrated(Rejected, { failureCode: FailureCode.InsufficientFunds });

    expect(tx.status).toBe(Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(tx.createdAt).toBe(PAST);
  });

  test("reconstrói uma transação PROCESSED com referência e processedAt", () => {
    const processedAt = new Date("2026-01-02T00:00:00.000Z");
    const tx = rehydrated(Processed, { kind: Refund, referenceTransactionId: "uuid-da-bet", processedAt });

    expect(tx.referenceTransactionId).toBe("uuid-da-bet");
    expect(tx.processedAt).toBe(processedAt);
  });

  test("não valida regras de criação: aceita até uma BET com referência vinda do banco", () => {
    expect(() => rehydrated(Processed, { referenceExternalTransactionId: "x" })).not.toThrow();
  });
});

describe("WagerTransaction: consultas", () => {
  test.each([
    [Bet, true],
    [Win, true],
    [Loss, false],
    [Refund, true],
    [Rollback, true],
    [Opening, true],
  ])("affectsBalance de %s → %p", (kind, expected) => {
    expect(rehydrated(Pending, { kind }).affectsBalance()).toBe(expected);
  });

  test.each([
    [Bet, false],
    [Win, false],
    [Loss, false],
    [Refund, true],
    [Rollback, true],
    [Opening, false],
  ])("requiresReference de %s → %p", (kind, expected) => {
    expect(rehydrated(Pending, { kind }).requiresReference()).toBe(expected);
  });

  test("matchesPayload: true com o mesmo hash, false com outro", () => {
    const tx = WagerTransaction.create(validProps({ payloadHash: "hash-abc" }));
    expect(tx.matchesPayload("hash-abc")).toBe(true);
    expect(tx.matchesPayload("hash-xyz")).toBe(false);
  });

  test.each([
    [Pending, false],
    [PendingReference, false],
    [Processed, true],
    [Rejected, true],
    [Failed, true],
  ])("isTerminal em %s → %p", (status, expected) => {
    expect(rehydrated(status).isTerminal()).toBe(expected);
  });
});

// =====================================================================================
// PARTE 2
// =====================================================================================

describe("WagerTransaction: transições válidas", () => {
  test("PENDING → markProcessed → PROCESSED, com processedAt = data passada e o saldo observado", () => {
    const tx = WagerTransaction.create(validProps());
    const at = new Date("2026-03-01T12:00:00.000Z");

    tx.markProcessed(undefined, at, brl("75.00"));

    expect(tx.status).toBe(Processed);
    expect(tx.processedAt).toBe(at);
    expect(tx.referenceTransactionId).toBeUndefined();
    expect(tx.balanceAfter?.equals(brl("75.00"))).toBe(true);
  });

  test("PENDING → markPendingReference → PENDING_REFERENCE", () => {
    const tx = withReference(Refund);
    tx.markPendingReference();
    expect(tx.status).toBe(PendingReference);
  });

  test("PENDING_REFERENCE → markPendingReference de novo → continua PENDING_REFERENCE (retry do worker)", () => {
    const tx = withReference(Refund);
    tx.markPendingReference();
    tx.markPendingReference();
    expect(tx.status).toBe(PendingReference);
  });

  test("PENDING_REFERENCE → markProcessed com referência → PROCESSED e guarda o id interno", () => {
    const tx = withReference(Refund);
    tx.markPendingReference();

    tx.markProcessed("uuid-da-bet", new Date(), brl("100.00"));

    expect(tx.status).toBe(Processed);
    expect(tx.referenceTransactionId).toBe("uuid-da-bet");
  });

  test("PENDING → reject → REJECTED com o failureCode", () => {
    const tx = WagerTransaction.create(validProps());
    tx.reject(FailureCode.InsufficientFunds);

    expect(tx.status).toBe(Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
  });

  test("PENDING_REFERENCE → reject(REFERENCE_NOT_FOUND) → REJECTED (limite de tentativas esgotado)", () => {
    const tx = withReference(Rollback);
    tx.markPendingReference();

    tx.reject(FailureCode.ReferenceNotFound);

    expect(tx.status).toBe(Rejected);
    expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
  });

  test("PENDING → fail → FAILED com o failureCode", () => {
    const tx = WagerTransaction.create(validProps());
    tx.fail(FailureCode.PermanentFailure);

    expect(tx.status).toBe(Failed);
    expect(tx.failureCode).toBe(FailureCode.PermanentFailure);
  });
});

describe("WagerTransaction: markProcessed sem referência em REFUND/ROLLBACK", () => {
  test.each([[Refund], [Rollback]])("%s → MissingReferenceError e NADA muda", (kind) => {
    const tx = withReference(kind);

    expect(() => tx.markProcessed(undefined, new Date(), brl("100.00"))).toThrow(MissingReferenceError);

    // O bug que você corrigiu: o status não pode ter virado PROCESSED antes do erro.
    expect(tx.status).toBe(Pending);
    expect(tx.processedAt).toBeUndefined();
    expect(tx.balanceAfter).toBeUndefined();
  });
});

describe("WagerTransaction: status terminal não muda", () => {
  const terminals = [Processed, Rejected, Failed];
  const transitions: [string, (tx: WagerTransaction) => void][] = [
    ["markProcessed", (tx) => tx.markProcessed(undefined, new Date(), brl("100.00"))],
    ["markPendingReference", (tx) => tx.markPendingReference()],
    ["reject", (tx) => tx.reject(FailureCode.InsufficientFunds)],
    ["fail", (tx) => tx.fail(FailureCode.PermanentFailure)],
  ];

  // 3 status × 4 transições = 12 casos.
  const cases = terminals.flatMap((status) =>
    transitions.map(([name, run]) => [status, name, run] as const),
  );

  test.each(cases)("%s → %s lança InvalidTransactionStateError e nada muda", (status, _name, run) => {
    const tx = rehydrated(status, { failureCode: FailureCode.AmountMismatch });

    expect(() => run(tx)).toThrow(InvalidTransactionStateError);

    expect(tx.status).toBe(status);
    expect(tx.failureCode).toBe(FailureCode.AmountMismatch);
  });

  test("a mensagem do erro diz o status atual e o pretendido", () => {
    const tx = rehydrated(Processed);
    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(/já está PROCESSED .* não pode ir para REJECTED/);
  });
});

describe("WagerTransaction.ledgerDirectionFor", () => {
  test("BET → Debit", () => {
    expect(rehydrated(Pending, { kind: Bet }).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  test.each([[Win], [Refund], [Opening]])("%s → Credit", (kind) => {
    expect(rehydrated(Pending, { kind }).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  test.each([
    [Bet, LedgerDirection.Credit], // devolve o que a aposta tirou
    [Win, LedgerDirection.Debit], // tira o que o ganho pagou
    [Refund, LedgerDirection.Debit], // tira o que o reembolso devolveu
  ])("ROLLBACK de %s → %s", (referenceKind, expected) => {
    const reference = rehydrated(Processed, { kind: referenceKind });
    const rollback = rehydrated(Pending, { kind: Rollback });

    expect(rollback.ledgerDirectionFor(reference)).toBe(expected);
  });

  test("ROLLBACK sem referência → LedgerDirectionUnavailableError", () => {
    const rollback = rehydrated(Pending, { kind: Rollback });
    expect(() => rollback.ledgerDirectionFor()).toThrow(LedgerDirectionUnavailableError);
  });

  test("LOSS → LedgerDirectionUnavailableError", () => {
    expect(() => rehydrated(Pending, { kind: Loss }).ledgerDirectionFor()).toThrow(LedgerDirectionUnavailableError);
  });

  test("ROLLBACK de LOSS → erro (o use case precisa rejeitar com INVALID_REFERENCE_KIND antes)", () => {
    const reference = rehydrated(Processed, { kind: Loss });
    const rollback = rehydrated(Pending, { kind: Rollback });
    expect(() => rollback.ledgerDirectionFor(reference)).toThrow(LedgerDirectionUnavailableError);
  });
});
