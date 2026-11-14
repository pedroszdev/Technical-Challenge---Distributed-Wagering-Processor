import { Injectable } from "@nestjs/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import { LockMode } from "@mikro-orm/postgresql";
import type { Wallet } from "../../../domain/wallet/wallet.ts";
import { WalletEntity } from "../entities/wallet.entity.ts";
import { walletToDomain, walletToRecord } from "../mappers/wallet.mapper.ts";
import { ConcurrentWalletUpdateError } from "../../../application/shared/concurrent-update.error.ts";
/**
 * Todo método recebe o `em` de quem chama. Assim o use case passa o `em` DA TRANSAÇÃO
 * e todas as escritas caem na mesma transação SQL.
 */
@Injectable()
export class WalletRepository {
  async insert(em: EntityManager, wallet: Wallet): Promise<void> {
    await em.insert(WalletEntity, walletToRecord(wallet));
  }

  async findById(em: EntityManager, id: string): Promise<Wallet | null> {
    const record = await em.findOne(WalletEntity, id);
    return record ? walletToDomain(record) : null;
  }

  // travar a wallet para ninguém mexer ao mesmo tempo
  async findByIdForUpdate(em: EntityManager, id: string): Promise<Wallet | null> {
    const record = await em.findOne(WalletEntity, id, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return record ? walletToDomain(record) : null;
  }
  /**
   * Grava o saldo e a versão novos. O WHERE exige a versão ANTIGA: se alguém tivesse
   * mudado a wallet no meio do caminho, nenhuma linha bateria e o UPDATE afetaria 0.
   */
  async update(em: EntityManager, wallet: Wallet, expectedVersion: number): Promise<void> {
    const affected = await em.nativeUpdate(
      WalletEntity,
      { id: wallet.id, version: expectedVersion },
      {
        balanceAmount: wallet.balance.toJSON().amount,
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    );
    if (affected !== 1) {
      throw new ConcurrentWalletUpdateError(wallet.id);
    }
  }

}
