import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { env } from "../../config/env.ts";
import { LedgerEntryEntity } from "./entities/ledger-entry.entity.ts";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity.ts";
import { WalletEntity } from "./entities/wallet.entity.ts";

/**
 * Configuração única do MikroORM, usada pela aplicação (AppModule)
 * e pela CLI (`bun run migration:*`).
 */
export default defineConfig({
  clientUrl: env.databaseUrl,

  // Formato das linhas do banco (não são as classes de domínio; ver mappers/).
  entities: [WalletEntity, WagerTransactionEntity, LedgerEntryEntity],

  extensions: [Migrator],
  migrations: {
    path: "./src/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
    glob: "!(*.d).ts",
    emit: "ts",
    // Cada migration roda dentro de uma transação; se falhar, nada fica pela metade.
    transactional: true,
    allOrNothing: true,
  },

  debug: false,
});
