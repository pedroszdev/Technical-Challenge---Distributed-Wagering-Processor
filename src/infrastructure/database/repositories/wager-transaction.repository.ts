import { Injectable } from "@nestjs/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransaction } from "../../../domain/wager-transaction/wager-transaction.ts";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity.ts";
import { wagerTransactionToDomain, wagerTransactionToRecord } from "../mappers/wager-transaction.mapper.ts";
import { WagerTransactionKind, WagerTransactionStatus } from "../../../domain/wager-transaction/wager-transaction.enums.ts";

@Injectable()
export class WagerTransactionRepository {
  async insert(em: EntityManager, transaction: WagerTransaction, schedule?: { nextAttemptAt?: Date }): Promise<void> {
    await em.insert(WagerTransactionEntity, wagerTransactionToRecord(transaction, schedule));
  }
  // "Essa key já foi usada por este provider?" → alimenta o decideIdempotency(). */
  async findByIdempotencyKey(em: EntityManager, providerId: string, idempotencyKey: string): Promise<WagerTransaction | null> {
    const record = await em.findOne(WagerTransactionEntity, { providerId, idempotencyKey });
    return record ? wagerTransactionToDomain(record) : null;
  }

  //achar a BET que um REFUND quer reverter
  async findByExternalId(em: EntityManager, providerId: string, externalTransactionId: string): Promise<WagerTransaction | null> {
    const record = await em.findOne(WagerTransactionEntity, {providerId, externalTransactionId})
    return record ? wagerTransactionToDomain(record) : null;
  }
  
  /**
   * Essa transação já foi revertida? Conta QUALQUER reversão processada (REFUND ou
   * ROLLBACK), não só a do mesmo tipo: senão um REFUND seguido de um ROLLBACK da
   * mesma BET devolveria o dinheiro duas vezes.
   */
  async hasProcessedReversal(em: EntityManager, referenceTransactionId: string): Promise<boolean> {
    const count = await em.count(WagerTransactionEntity, {
      referenceTransactionId,
      kind: { $in: [WagerTransactionKind.Refund, WagerTransactionKind.Rollback] },
      status: WagerTransactionStatus.Processed,
    });
    return count > 0;
  }

}
