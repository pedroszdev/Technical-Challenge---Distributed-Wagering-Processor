import { defineEntity, p, type InferEntity } from "@mikro-orm/postgresql";

/** Formato de uma linha da tabela `wager_transactions`. */
export const WagerTransactionEntity = defineEntity({
  name: "WagerTransactionEntity",
  tableName: "wager_transactions",
  properties: {
    id: p.uuid().primary(),
    providerId: p.text(),
    externalTransactionId: p.text(),
    idempotencyKey: p.text(),
    payloadHash: p.text(),
    walletId: p.uuid(),
    playerId: p.uuid(),
    roundId: p.text(),
    gameId: p.text(),
    // Texto livre aqui; os valores válidos são garantidos pelo CHECK no banco.
    kind: p.text(),
    amount: p.decimal().columnType("numeric(20,2)"),
    currency: p.string().columnType("char(3)"),
    referenceExternalTransactionId: p.text().nullable(),
    referenceTransactionId: p.uuid().nullable(),
    status: p.text(),
    failureCode: p.text().nullable(),
    balanceAfterAmount: p.decimal().columnType("numeric(20,2)").nullable(),
    attempts: p.integer(),
    nextAttemptAt: p.datetime().nullable(),
    createdAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});

export type WagerTransactionRecord = InferEntity<typeof WagerTransactionEntity>;
