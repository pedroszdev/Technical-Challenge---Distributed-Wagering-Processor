import { Module } from "@nestjs/common";
import { WalletRepository } from "./repositories/wallet.repository.ts";
import { WagerTransactionRepository } from "./repositories/wager-transaction.repository.ts";
import { LedgerEntryRepository } from "./repositories/ledger-entry.repository.ts";

@Module({
  providers: [WalletRepository, WagerTransactionRepository, LedgerEntryRepository],
  exports: [WalletRepository, WagerTransactionRepository, LedgerEntryRepository],
})
export class DatabaseModule {}
