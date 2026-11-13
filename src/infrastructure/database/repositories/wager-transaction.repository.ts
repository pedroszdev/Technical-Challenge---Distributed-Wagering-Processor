import { Injectable } from "@nestjs/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransaction } from "../../../domain/wager-transaction/wager-transaction.ts";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity.ts";
import { wagerTransactionToRecord } from "../mappers/wager-transaction.mapper.ts";

@Injectable()
export class WagerTransactionRepository {
  async insert(em: EntityManager, transaction: WagerTransaction): Promise<void> {
    await em.insert(WagerTransactionEntity, wagerTransactionToRecord(transaction));
  }
}
