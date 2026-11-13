import { describe, expect, test } from "bun:test";
import { decideIdempotency } from "./idempotency.ts";
import { computePayloadHash } from "./payload-hash.ts";
import { IdempotencyConflictError } from "./wagering.errors.ts";
import type { WagerTransactionInput } from "../../http/wager-transaction.request.ts";
import { Money } from "../../domain/money/money.ts";
import { FailureCode } from "../../domain/wager-transaction/failure-code.ts";
import { WagerTransaction } from "../../domain/wager-transaction/wager-transaction.ts";
import { WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager-transaction/wager-transaction.enums.ts";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

/** Transação "já salva no banco", com um payloadHash conhecido. */
const existingTransaction = (payloadHash: string, status = WagerTransactionStatus.Processed) =>
  WagerTransaction.rehydrate({
    id: "tx-internal-1",
    providerId: "provider-a",
    externalTransactionId: "transaction-123",
    idempotencyKey: "provider-a:transaction-123",
    payloadHash,
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-987",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: brl("25.00"),
    referenceExternalTransactionId: undefined,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    status,
    failureCode: status === WagerTransactionStatus.Rejected ? FailureCode.InsufficientFunds : undefined,
  });

describe("decideIdempotency", () => {
  test("nada encontrado com essa key → new (processa normalmente)", () => {
    expect(decideIdempotency(null, "hash-abc")).toEqual({ type: "new" });
  });

  test("encontrada com o MESMO hash → replay, trazendo a própria transação salva", () => {
    const existing = existingTransaction("hash-abc");

    const decision = decideIdempotency(existing, "hash-abc");

    expect(decision.type).toBe("replay");
    // toBe (e não toEqual): é a MESMA instância, não uma cópia.
    if (decision.type === "replay") expect(decision.transaction).toBe(existing);
  });

  test("encontrada com hash DIFERENTE → conflict (a key foi reusada para outro pedido)", () => {
    const existing = existingTransaction("hash-abc");

    const decision = decideIdempotency(existing, "hash-OUTRO");

    expect(decision.type).toBe("conflict");
    if (decision.type === "conflict") expect(decision.transaction).toBe(existing);
  });

  // Regra 7: repetir uma operação devolve o resultado ORIGINAL, seja ele qual for.
  // Um replay de uma aposta REJEITADA devolve a rejeição; não tenta processar de novo.
  test.each([
    [WagerTransactionStatus.Processed],
    [WagerTransactionStatus.Rejected],
    [WagerTransactionStatus.PendingReference],
    [WagerTransactionStatus.Failed],
  ])("replay vale em qualquer status: %s", (status) => {
    const existing = existingTransaction("hash-abc", status);
    expect(decideIdempotency(existing, "hash-abc").type).toBe("replay");
  });
});

describe("decideIdempotency + computePayloadHash (partes B e C juntas)", () => {
  const input = (overrides: Partial<WagerTransactionInput> = {}): WagerTransactionInput => ({
    idempotencyKey: "provider-a:transaction-123",
    providerId: "provider-a",
    externalTransactionId: "transaction-123",
    playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
    roundId: "round-987",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: brl("25.00"),
    referenceExternalTransactionId: undefined,
    ...overrides,
  });

  /** Simula: o primeiro pedido foi salvo com o hash dele. */
  const saved = existingTransaction(computePayloadHash(input()));

  test("reenvio idêntico → replay", () => {
    expect(decideIdempotency(saved, computePayloadHash(input())).type).toBe("replay");
  });

  test("reenvio idêntico com '25' em vez de '25.00' → replay (mesmo valor)", () => {
    expect(decideIdempotency(saved, computePayloadHash(input({ money: brl("25") }))).type).toBe("replay");
  });

  test("mesma key, R$250 em vez de R$25 → conflict", () => {
    expect(decideIdempotency(saved, computePayloadHash(input({ money: brl("250.00") }))).type).toBe("conflict");
  });

  test("mesma key, WIN em vez de BET → conflict", () => {
    expect(decideIdempotency(saved, computePayloadHash(input({ kind: WagerTransactionKind.Win }))).type).toBe(
      "conflict",
    );
  });
});

describe("IdempotencyConflictError", () => {
  test("tem o código estável IDEMPOTENCY_CONFLICT e guarda a key e a transação existente", () => {
    const error = new IdempotencyConflictError("provider-a:transaction-123", "tx-internal-1");

    expect(error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(error.idempotencyKey).toBe("provider-a:transaction-123");
    expect(error.existingTransactionId).toBe("tx-internal-1");
    expect(error.message).toContain("provider-a:transaction-123");
  });
});
