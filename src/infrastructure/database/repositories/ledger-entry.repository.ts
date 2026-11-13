import { Injectable } from "@nestjs/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { WalletLedgerEntry } from "../../../domain/ledger/ledger-entry.ts";
import { LedgerEntryEntity } from "../entities/ledger-entry.entity.ts";
import { ledgerEntryToRecord } from "../mappers/ledger-entry.mapper.ts";

/** Só INSERT: o ledger é imutável (o trigger no banco recusa UPDATE/DELETE). */
@Injectable()
export class LedgerEntryRepository {
  async insert(em: EntityManager, entry: WalletLedgerEntry): Promise<void> {
    await em.insert(LedgerEntryEntity, ledgerEntryToRecord(entry));
  }
}
