import { describe, expect, test } from "bun:test";
import { checkReversal } from "./reversal-rules.ts";
import { Money } from "../../domain/money/money.ts";
import { FailureCode } from "../../domain/wager-transaction/failure-code.ts";
import { WagerTransaction, type WagerTransactionState } from "../../domain/wager-transaction/wager-transaction.ts";
import { WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager-transaction/wager-transaction.enums.ts";

const { Bet, Win, Loss, Refund, Rollback, Opening } = WagerTransactionKind;
const { Pending, PendingReference, Processed, Rejected, Failed } = WagerTransactionStatus;

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

/** Uma transação "do banco". Por padrão: BET PROCESSED de R$25 do João, na rodada round-987. */
const tx = (overrides: Partial<WagerTransactionState> = {}) =>
  WagerTransaction.rehydrate({
    id: "tx-original",
    providerId: "provider-a",
    externalTransactionId: "transaction-100",
    idempotencyKey: "provider-a:transaction-100",
    payloadHash: "hash",
    walletId: "wallet-joao",
    playerId: "player-joao",
    roundId: "round-987",
    gameId: "fortune-chimp",
    kind: Bet,
    money: brl("25.00"),
    referenceExternalTransactionId: undefined,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    status: Processed,
    balanceAfter: brl("75.00"),
    ...overrides,
  });

/** O par VÁLIDO: a referência (BET PROCESSED) e a reversão que acabou de chegar (PENDING). */
const reference = (overrides: Partial<WagerTransactionState> = {}) => tx(overrides);
const reversal = (kind: WagerTransactionKind = Refund, overrides: Partial<WagerTransactionState> = {}) =>
  tx({
    id: "tx-reversal",
    externalTransactionId: "transaction-200",
    idempotencyKey: "provider-a:transaction-200",
    kind,
    referenceExternalTransactionId: "transaction-100",
    status: Pending,
    balanceAfter: undefined,
    ...overrides,
  });

describe("checkReversal: par válido", () => {
  test("REFUND de uma BET PROCESSED, mesmo contexto e mesmo valor → undefined (pode reverter)", () => {
    expect(checkReversal(reversal(Refund), reference(), false)).toBeUndefined();
  });
});

describe("regra 1: mesmo player, wallet, moeda e rodada → senão REFERENCE_MISMATCH", () => {
  test.each<[string, Partial<WagerTransactionState>]>([
    ["player diferente", { playerId: "player-maria" }],
    ["wallet diferente", { walletId: "wallet-maria" }],
    ["rodada diferente", { roundId: "round-1" }],
    ["moeda diferente", { money: Money.from({ amount: "25.00", currency: "USD" }) }],
  ])("%s", (_, override) => {
    expect(checkReversal(reversal(Refund, override), reference(), false)).toBe(FailureCode.ReferenceMismatch);
  });

  test("UMA diferença já basta: player e wallet diferentes, moeda e rodada iguais (pegaria o bug do &&)", () => {
    // O caso da Maria pedindo o reembolso da aposta do João.
    const maria = reversal(Refund, { playerId: "player-maria", walletId: "wallet-maria" });
    expect(checkReversal(maria, reference(), false)).toBe(FailureCode.ReferenceMismatch);
  });

  test("vale também para ROLLBACK", () => {
    expect(checkReversal(reversal(Rollback, { roundId: "round-1" }), reference(), false)).toBe(
      FailureCode.ReferenceMismatch,
    );
  });
});

describe("regra 2: tipos de referência permitidos → senão INVALID_REFERENCE_KIND", () => {
  test.each([[Win], [Loss], [Refund], [Rollback], [Opening]])("REFUND de %s → INVALID_REFERENCE_KIND", (kind) => {
    expect(checkReversal(reversal(Refund), reference({ kind }), false)).toBe(FailureCode.InvalidReferenceKind);
  });

  test.each([[Bet], [Win], [Refund]])("ROLLBACK de %s → permitido", (kind) => {
    expect(checkReversal(reversal(Rollback), reference({ kind }), false)).toBeUndefined();
  });

  test.each([[Loss], [Rollback], [Opening]])("ROLLBACK de %s → INVALID_REFERENCE_KIND", (kind) => {
    // ROLLBACK de LOSS: é ESTA regra que impede o use case de chamar o ledgerDirectionFor
    // numa LOSS (que lançaria erro). Vira uma rejeição limpa em vez de um 500.
    expect(checkReversal(reversal(Rollback), reference({ kind }), false)).toBe(FailureCode.InvalidReferenceKind);
  });
});

describe("regra 3: a referência precisa estar PROCESSED → senão REFERENCE_NOT_PROCESSED", () => {
  test.each([[Pending], [PendingReference], [Rejected], [Failed]])("referência %s", (status) => {
    // REJECTED é o caso perigoso: a BET nunca debitou, então o REFUND devolveria dinheiro do nada.
    expect(checkReversal(reversal(Refund), reference({ status }), false)).toBe(FailureCode.ReferenceNotProcessed);
  });

  test("referência PROCESSED passa (pegaria o bug do === invertido)", () => {
    expect(checkReversal(reversal(Refund), reference({ status: Processed }), false)).toBeUndefined();
  });
});

describe("regra 4: o mesmo valor da referência → senão AMOUNT_MISMATCH", () => {
  test.each([["30.00"], ["24.99"], ["0.01"]])("REFUND de %s numa BET de 25.00", (amount) => {
    expect(checkReversal(reversal(Refund, { money: brl(amount) }), reference(), false)).toBe(
      FailureCode.AmountMismatch,
    );
  });

  test("'25' e '25.00' são o mesmo valor", () => {
    expect(checkReversal(reversal(Refund, { money: brl("25") }), reference(), false)).toBeUndefined();
  });
});

describe("regra 5: ainda não revertida por esse tipo → senão ALREADY_REVERSED", () => {
  test("alreadyReversed = true → ALREADY_REVERSED", () => {
    expect(checkReversal(reversal(Refund), reference(), true)).toBe(FailureCode.AlreadyReversed);
  });

  test("alreadyReversed = false → pode reverter", () => {
    expect(checkReversal(reversal(Refund), reference(), false)).toBeUndefined();
  });
});

describe("ordem das regras: quando várias falham, a primeira da lista ganha", () => {
  test("contexto errado (1) + valor errado (4) → REFERENCE_MISMATCH", () => {
    const r = reversal(Refund, { playerId: "player-maria", money: brl("30.00") });
    expect(checkReversal(r, reference(), false)).toBe(FailureCode.ReferenceMismatch);
  });

  test("tipo errado (2) + não processada (3) → INVALID_REFERENCE_KIND", () => {
    expect(checkReversal(reversal(Refund), reference({ kind: Win, status: Rejected }), false)).toBe(
      FailureCode.InvalidReferenceKind,
    );
  });

  test("não processada (3) + valor errado (4) → REFERENCE_NOT_PROCESSED", () => {
    const r = reversal(Refund, { money: brl("30.00") });
    expect(checkReversal(r, reference({ status: Rejected }), false)).toBe(FailureCode.ReferenceNotProcessed);
  });

  test("valor errado (4) + já revertida (5) → AMOUNT_MISMATCH", () => {
    expect(checkReversal(reversal(Refund, { money: brl("30.00") }), reference(), true)).toBe(
      FailureCode.AmountMismatch,
    );
  });
});
