import { Injectable } from "@nestjs/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Wallet } from "../../../domain/wallet/wallet.ts";
import { WalletEntity } from "../entities/wallet.entity.ts";
import { walletToDomain, walletToRecord } from "../mappers/wallet.mapper.ts";

/**
 * Todo método recebe o `em` de quem chama. Assim o use case passa o `em` DA TRANSAÇÃO
 * e todas as escritas caem na mesma transação SQL.
 */
@Injectable()
export class WalletRepository {
  /** INSERT imediato (em.insert), na ordem chamada: importante por causa das FKs. */
  async insert(em: EntityManager, wallet: Wallet): Promise<void> {
    await em.insert(WalletEntity, walletToRecord(wallet));
  }

  async findById(em: EntityManager, id: string): Promise<Wallet | null> {
    const record = await em.findOne(WalletEntity, id);
    return record ? walletToDomain(record) : null;
  }
}
