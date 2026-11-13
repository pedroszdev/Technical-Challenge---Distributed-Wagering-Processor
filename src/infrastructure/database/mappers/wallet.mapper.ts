import { Money } from "../../../domain/money/money.ts";
import { Wallet } from "../../../domain/wallet/wallet.ts";
import type { WalletRecord } from "../entities/wallet.entity.ts";

/** Domínio -> linha do banco. O Money vira duas colunas: valor (string) + moeda. */
export function walletToRecord(wallet: Wallet): WalletRecord {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balanceAmount: wallet.balance.toJSON().amount,
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

/** Linha do banco -> domínio. Usa o rehydrate: não revalida regras de criação. */
export function walletToDomain(record: WalletRecord): Wallet {
  return Wallet.rehydrate({
    id: record.id,
    playerId: record.playerId,
    currency: record.currency,
    balance: Money.from({ amount: record.balanceAmount, currency: record.currency }),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}
