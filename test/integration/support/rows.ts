import { getConnection } from "./database.ts";

/**
 * Helpers para inserir linhas VÁLIDAS direto no banco (sem passar pela aplicação).
 * Cada teste troca só o campo que quer testar, igual ao validProps() dos testes
 * de unidade. Os nomes das chaves são os nomes das colunas (snake_case).
 */
type Row = Record<string, unknown>;

export const newId = () => Bun.randomUUIDv7();

export async function insertRow(table: string, row: Row): Promise<void> {
  const conn = await getConnection();
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  await conn.execute(
    `insert into ${table} (${columns.join(", ")}) values (${placeholders})`,
    Object.values(row),
  );
}

export async function insertWallet(overrides: Row = {}): Promise<Row & { id: string; player_id: string }> {
  const now = new Date();
  const row = {
    id: newId(),
    player_id: newId(),
    currency: "BRL",
    balance_amount: "100.00",
    version: 1,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await insertRow("wallets", row);
  return row as Row & { id: string; player_id: string };
}

type TransactionRow = Row & { id: string; wallet_id: string; external_transaction_id: string; idempotency_key: string };

/** Uma BET PROCESSED válida na wallet informada. */
export async function insertTransaction(
  wallet: { id: string; player_id: string },
  overrides: Row = {},
): Promise<TransactionRow> {
  const now = new Date();
  const externalId = `tx-${newId()}`;
  const row = {
    id: newId(),
    provider_id: "provider-a",
    external_transaction_id: externalId,
    idempotency_key: `provider-a:${externalId}`,
    payload_hash: "hash",
    wallet_id: wallet.id,
    player_id: wallet.player_id,
    round_id: "round-1",
    game_id: "game-1",
    kind: "BET",
    amount: "30.00",
    currency: "BRL",
    status: "PROCESSED",
    balance_after_amount: "70.00",
    created_at: now,
    processed_at: now,
    ...overrides,
  };
  await insertRow("wager_transactions", row);
  return row as TransactionRow;
}

/** Um lançamento DEBIT válido (100.00 - 30.00 = 70.00) da transação informada. */
export async function insertLedgerEntry(
  transaction: { id: string; wallet_id: unknown },
  overrides: Row = {},
): Promise<Row & { id: string }> {
  const row = {
    id: newId(),
    wallet_id: transaction.wallet_id,
    transaction_id: transaction.id,
    direction: "DEBIT",
    amount: "30.00",
    currency: "BRL",
    balance_before_amount: "100.00",
    balance_after_amount: "70.00",
    created_at: new Date(),
    ...overrides,
  };
  await insertRow("wallet_ledger_entries", row);
  return row as Row & { id: string };
}
