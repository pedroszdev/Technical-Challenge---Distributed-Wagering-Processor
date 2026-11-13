import type { LedgerDirection } from "../../../domain/ledger/ledger-direction.ts";
import { WalletLedgerEntry } from "../../../domain/ledger/ledger-entry.ts";
import { Money } from "../../../domain/money/money.ts";
import type { LedgerEntryRecord } from "../entities/ledger-entry.entity.ts";

export function ledgerEntryToRecord(entry: WalletLedgerEntry): LedgerEntryRecord {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    amount: entry.money.toJSON().amount,
    currency: entry.money.currency,
    balanceBeforeAmount: entry.balanceBefore.toJSON().amount,
    balanceAfterAmount: entry.balanceAfter.toJSON().amount,
    createdAt: entry.createdAt,
  };
}

export function ledgerEntryToDomain(record: LedgerEntryRecord): WalletLedgerEntry {
  const money = (amount: string) => Money.from({ amount, currency: record.currency });

  return WalletLedgerEntry.rehydrate({
    id: record.id,
    walletId: record.walletId,
    transactionId: record.transactionId,
    direction: record.direction as LedgerDirection,
    money: money(record.amount),
    balanceBefore: money(record.balanceBeforeAmount),
    balanceAfter: money(record.balanceAfterAmount),
    createdAt: record.createdAt,
  });
}
