import { Money } from "../../../domain/money/money.ts";
import type { FailureCode } from "../../../domain/wager-transaction/failure-code.ts";
import { WagerTransaction } from "../../../domain/wager-transaction/wager-transaction.ts";
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/wager-transaction/wager-transaction.enums.ts";
import type { WagerTransactionRecord } from "../entities/wager-transaction.entity.ts";

/**
 * Domínio -> linha do banco.
 * `attempts` e `nextAttemptAt` são controle do worker de PENDING_REFERENCE (dia 2);
 * por enquanto uma transação nova começa com 0 tentativas.
 */
export function wagerTransactionToRecord(tx: WagerTransaction): WagerTransactionRecord {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    idempotencyKey: tx.idempotencyKey,
    payloadHash: tx.payloadHash,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    amount: tx.money.toJSON().amount,
    currency: tx.money.currency,
    // O domínio usa undefined; a coluna nullable usa null.
    referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
    referenceTransactionId: tx.referenceTransactionId ?? null,
    status: tx.status,
    failureCode: tx.failureCode ?? null,
    balanceAfterAmount: tx.balanceAfter?.toJSON().amount ?? null,
    attempts: 0,
    nextAttemptAt: null,
    createdAt: tx.createdAt,
    processedAt: tx.processedAt ?? null,
  };
}

/** Linha do banco -> domínio. Os casts de enum são seguros: o CHECK do banco garante os valores. */
export function wagerTransactionToDomain(record: WagerTransactionRecord): WagerTransaction {
  const money = (amount: string) => Money.from({ amount, currency: record.currency });

  return WagerTransaction.rehydrate({
    id: record.id,
    providerId: record.providerId,
    externalTransactionId: record.externalTransactionId,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    walletId: record.walletId,
    playerId: record.playerId,
    roundId: record.roundId,
    gameId: record.gameId,
    kind: record.kind as WagerTransactionKind,
    money: money(record.amount),
    referenceExternalTransactionId: record.referenceExternalTransactionId ?? undefined,
    createdAt: record.createdAt,
    status: record.status as WagerTransactionStatus,
    referenceTransactionId: record.referenceTransactionId ?? undefined,
    failureCode: (record.failureCode ?? undefined) as FailureCode | undefined,
    processedAt: record.processedAt ?? undefined,
    balanceAfter: record.balanceAfterAmount ? money(record.balanceAfterAmount) : undefined,
  });
}
