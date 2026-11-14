import { Module } from "@nestjs/common";
import { CreateWalletUseCase } from "./application/wallet/create-wallet.use-case.ts";
import { GetWalletUseCase } from "./application/wallet/get-wallet.use-case.ts";
import { WalletsController } from "./http/wallets.controller.ts";
import { DatabaseModule } from "./infrastructure/database/database.module.ts";

/** Liga as peças: o Nest cria cada provider uma vez e injeta onde for pedido. */
@Module({
  imports: [DatabaseModule],
  controllers: [WalletsController],
  providers: [
    CreateWalletUseCase,
    GetWalletUseCase,
  ],
})
export class WalletsModule {}
