import { MikroORM } from "@mikro-orm/postgresql";
import config from "../../../src/infrastructure/database/mikro-orm.config.ts";

/**
 * Banco de teste (wagering_test, vindo do .env.test que o `bun test` carrega
 * sozinho porque define NODE_ENV=test). O banco de dev nunca é tocado.
 */
let ormPromise: Promise<MikroORM> | undefined;

/**
 * Conecta e, NA PRIMEIRA CHAMADA, recria o schema do zero rodando as migrations.
 * Como o Bun roda os arquivos de teste no mesmo processo, as próximas chamadas
 * reaproveitam a mesma conexão. Bônus: toda execução testa as migrations.
 */
export function getTestOrm(): Promise<MikroORM> {
  ormPromise ??= (async () => {
    if (!config.clientUrl?.endsWith("/wagering_test")) {
      // Trava de segurança: nunca apagar o schema de outro banco por engano.
      throw new Error(`Testes de integração só rodam no wagering_test (recebido: ${config.clientUrl})`);
    }
    const orm = await MikroORM.init(config);
    await orm.em.getConnection().execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await orm.migrator.up();
    return orm;
  })();
  return ormPromise;
}

/** Atalho para a conexão crua (SQL direto). */
export async function getConnection() {
  return (await getTestOrm()).em.getConnection();
}

/**
 * Executa SQL cru e devolve as linhas. O retorno é `any` de propósito: nos testes
 * a gente compara as linhas com `expect`, e tipar cada consulta só adicionaria ruído.
 */
export async function sql(query: string, params: unknown[] = []): Promise<any[]> {
  return (await getConnection()).execute(query, params);
}

/**
 * Apaga TODOS os dados. Use só quando o teste precisa de tabela vazia.
 *
 * O trigger de imutabilidade bloqueia TRUNCATE no ledger (o que é bom).
 * `session_replication_role = replica` desliga triggers SÓ nesta sessão;
 * exige superusuário (é o caso no Docker local, não seria em produção).
 */
export async function truncateAll(): Promise<void> {
  const conn = await getConnection();
  await conn.execute(`
    SET session_replication_role = replica;
    TRUNCATE wallet_ledger_entries, wager_transactions, wallets, inbox_messages, outbox_messages;
    SET session_replication_role = DEFAULT;
  `);
}

export async function closeTestOrm(): Promise<void> {
  if (ormPromise) await (await ormPromise).close();
  ormPromise = undefined;
}
