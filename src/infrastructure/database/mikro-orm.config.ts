import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { env } from "../../config/env.ts";

/**
 * Configuração única do MikroORM, usada pela aplicação (AppModule)
 * e pela CLI (`bun run migration:*`).
 */
export default defineConfig({
  clientUrl: env.databaseUrl,

  // Registre aqui os mapeamentos das suas entidades conforme for criando.
  // Dica: como o domínio não pode depender do ORM, `defineEntity`/`EntitySchema`
  // permite mapear classes de domínio sem colocar decorators nelas.
  entities: [],
  discovery: { warnWhenNoEntities: false },

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
