import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { Wallet } from "../../domain/wallet/wallet.ts";
import { WalletRepository } from "../../infrastructure/database/repositories/wallet.repository.ts";
import { WalletNotFoundError } from "./wallet.errors.ts";

@Injectable()
export class GetWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly wallets: WalletRepository,
  ) {}

  async execute(walletId: string): Promise<Wallet> {
    // fork(): um EntityManager novo, com identity map limpo, só para esta leitura.
    const wallet = await this.wallets.findById(this.em.fork(), walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }
    return wallet;
  }
}
