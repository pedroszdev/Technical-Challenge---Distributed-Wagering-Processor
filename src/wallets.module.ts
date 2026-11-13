import { Module } from "@nestjs/common";
import { CreateWalletUseCase } from "./application/wallet/create-wallet.use-case.ts";
import { GetWalletUseCase } from "./application/wallet/get-wallet.use-case.ts";
import { WalletsController } from "./http/wallets.controller.ts";
import { LedgerEntryRepository } from "./infrastructure/database/repositories/ledger-entry.repository.ts";
import { WagerTransactionRepository } from "./infrastructure/database/repositories/wager-transaction.repository.ts";
import { WalletRepository } from "./infrastructure/database/repositories/wallet.repository.ts";

/** Liga as peças: o Nest cria cada provider uma vez e injeta onde for pedido. */
@Module({
  controllers: [WalletsController],
  providers: [
    CreateWalletUseCase,
    GetWalletUseCase,
    WalletRepository,
    WagerTransactionRepository,
    LedgerEntryRepository,
  ],
})
export class WalletsModule {}
