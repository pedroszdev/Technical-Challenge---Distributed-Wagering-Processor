import { defineEntity, p, type InferEntity } from "@mikro-orm/postgresql";

/** Formato de uma linha da tabela `wallet_ledger_entries` (imutável: só INSERT). */
export const LedgerEntryEntity = defineEntity({
  name: "LedgerEntryEntity",
  tableName: "wallet_ledger_entries",
  properties: {
    id: p.uuid().primary(),
    walletId: p.uuid(),
    transactionId: p.uuid(),
    direction: p.text(),
    amount: p.decimal().columnType("numeric(20,2)"),
    currency: p.string().columnType("char(3)"),
    balanceBeforeAmount: p.decimal().columnType("numeric(20,2)"),
    balanceAfterAmount: p.decimal().columnType("numeric(20,2)"),
    createdAt: p.datetime(),
  },
});

export type LedgerEntryRecord = InferEntity<typeof LedgerEntryEntity>;
