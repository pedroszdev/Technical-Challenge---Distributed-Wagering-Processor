import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeTestOrm, getTestOrm, sql } from "./support/database.ts";
import { insertLedgerEntry, insertRow, insertTransaction, insertWallet, newId } from "./support/rows.ts";

/**
 * Prova a restrição 9 do README: as garantias estão NO BANCO.
 * Cada teste insere uma linha inválida direto via SQL (sem passar pela aplicação)
 * e confere que o erro veio da constraint CERTA (pelo nome), não de outra qualquer.
 */

beforeAll(async () => {
  await getTestOrm();
});
afterAll(async () => {
  await closeTestOrm();
});

describe("migrations", () => {
  test("criam as 5 tabelas do domínio", async () => {
    const rows = await sql(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> 'mikro_orm_migrations' order by 1",
    );
    expect(rows.map((r: { tablename: string }) => r.tablename)).toEqual([
      "inbox_messages",
      "outbox_messages",
      "wager_transactions",
      "wallet_ledger_entries",
      "wallets",
    ]);
  });
});

describe("wallets", () => {
  test("saldo negativo é recusado", async () => {
    const wallet = await insertWallet();
    await expect(sql("update wallets set balance_amount = -0.01 where id = ?", [wallet.id])).rejects.toThrow(
      "wallets_balance_non_negative_ck",
    );
  });

  test("segunda wallet BRL para o mesmo player é recusada", async () => {
    const wallet = await insertWallet();
    await expect(insertWallet({ player_id: wallet.player_id })).rejects.toThrow("wallets_player_currency_uq");
  });

  test("o mesmo player pode ter uma wallet em outra moeda", async () => {
    const wallet = await insertWallet();
    await insertWallet({ player_id: wallet.player_id, currency: "USD" });
  });

  test("moeda fora do formato ISO-4217 é recusada", async () => {
    await expect(insertWallet({ currency: "brl" })).rejects.toThrow("wallets_currency_format_ck");
  });
});

describe("wager_transactions", () => {
  test("idempotency key repetida no mesmo provider é recusada", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await expect(insertTransaction(wallet, { idempotency_key: tx.idempotency_key })).rejects.toThrow(
      "wager_tx_provider_idempotency_key_uq",
    );
  });

  test("a mesma idempotency key em OUTRO provider é permitida", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await insertTransaction(wallet, { provider_id: "provider-b", idempotency_key: tx.idempotency_key });
  });

  test("externalTransactionId repetido no mesmo provider é recusado", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await expect(
      insertTransaction(wallet, { external_transaction_id: tx.external_transaction_id }),
    ).rejects.toThrow("wager_tx_provider_external_id_uq");
  });

  test("transação de um player que NÃO é o dono da wallet é recusada (FK composta)", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction({ id: wallet.id, player_id: newId() })).rejects.toThrow("wager_tx_wallet_fk");
  });

  test("transação em moeda diferente da wallet é recusada (FK composta)", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { currency: "USD" })).rejects.toThrow("wager_tx_wallet_fk");
  });

  test("kind fora da lista é recusado", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { kind: "JACKPOT" })).rejects.toThrow("wager_tx_kind_ck");
  });

  test("REFUND sem referência é recusado", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { kind: "REFUND", status: "PENDING" })).rejects.toThrow(
      "wager_tx_reversal_requires_reference_ck",
    );
  });

  test("BET com referência é recusada", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { reference_external_transaction_id: "x" })).rejects.toThrow(
      "wager_tx_bet_has_no_reference_ck",
    );
  });

  test("BET com valor zero é recusada; LOSS com zero é permitido", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { amount: "0.00" })).rejects.toThrow(
      "wager_tx_amount_positive_unless_loss_ck",
    );
    await insertTransaction(wallet, { kind: "LOSS", amount: "0.00", balance_after_amount: "100.00" });
  });

  test("REJECTED sem failure_code é recusado", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await expect(sql("update wager_transactions set status = 'REJECTED' where id = ?", [tx.id])).rejects.toThrow(
      "wager_tx_failure_code_iff_failed_ck",
    );
  });

  test("PROCESSED com failure_code é recusado", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { failure_code: "INSUFFICIENT_FUNDS" })).rejects.toThrow(
      "wager_tx_failure_code_iff_failed_ck",
    );
  });

  test("PROCESSED sem processed_at é recusado", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { processed_at: null })).rejects.toThrow(
      "wager_tx_processed_has_timestamp_ck",
    );
  });

  test("PROCESSED sem saldo observado é recusado", async () => {
    const wallet = await insertWallet();
    await expect(insertTransaction(wallet, { balance_after_amount: null })).rejects.toThrow(
      "wager_tx_processed_has_balance_ck",
    );
  });

  test("REFUND PROCESSED sem a referência interna resolvida é recusado", async () => {
    const wallet = await insertWallet();
    await expect(
      insertTransaction(wallet, { kind: "REFUND", reference_external_transaction_id: "bet-1" }),
    ).rejects.toThrow("wager_tx_processed_reversal_resolved_ck");
  });
});

describe("wager_transactions: uma reversão por tipo (regra 4)", () => {
  const reversalOf = (bet: { id: string; external_transaction_id: string }, kind: "REFUND" | "ROLLBACK") => ({
    kind,
    reference_external_transaction_id: bet.external_transaction_id,
    reference_transaction_id: bet.id,
    balance_after_amount: "100.00",
  });

  test("dois REFUNDs PROCESSED da mesma BET: o segundo é recusado", async () => {
    const wallet = await insertWallet();
    const bet = await insertTransaction(wallet);
    await insertTransaction(wallet, reversalOf(bet, "REFUND"));

    await expect(insertTransaction(wallet, reversalOf(bet, "REFUND"))).rejects.toThrow(
      "wager_tx_single_reversal_per_kind_uq",
    );
  });

  test("REFUND e ROLLBACK da mesma BET: os dois são permitidos (tipos diferentes)", async () => {
    const wallet = await insertWallet();
    const bet = await insertTransaction(wallet);
    await insertTransaction(wallet, reversalOf(bet, "REFUND"));
    await insertTransaction(wallet, reversalOf(bet, "ROLLBACK"));
  });

  test("um REFUND REJECTED não bloqueia um REFUND válido depois", async () => {
    const wallet = await insertWallet();
    const bet = await insertTransaction(wallet);
    await insertTransaction(wallet, {
      ...reversalOf(bet, "REFUND"),
      status: "REJECTED",
      failure_code: "AMOUNT_MISMATCH",
      processed_at: null,
      balance_after_amount: null,
    });
    await insertTransaction(wallet, reversalOf(bet, "REFUND"));
  });
});

describe("wallet_ledger_entries", () => {
  test("lançamento com a conta errada (100 - 30 = 80) é recusado", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await expect(insertLedgerEntry(tx, { balance_after_amount: "80.00" })).rejects.toThrow("ledger_balanced_ck");
  });

  test("DEBIT com a conta de um CREDIT (100 → 130) é recusado", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await expect(insertLedgerEntry(tx, { balance_after_amount: "130.00" })).rejects.toThrow("ledger_balanced_ck");
  });

  test("segundo lançamento para a mesma transação é recusado", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await insertLedgerEntry(tx);
    await expect(insertLedgerEntry(tx)).rejects.toThrow("ledger_transaction_wallet_uq");
  });

  test("lançamento em USD numa wallet BRL é recusado (FK composta)", async () => {
    // Transação nova, sem lançamento: assim o UNIQUE não dispara antes da FK.
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await expect(insertLedgerEntry(tx, { currency: "USD" })).rejects.toThrow("ledger_wallet_fk");
  });

  test("lançamento apontando para transação de OUTRA wallet é recusado (FK composta)", async () => {
    const walletA = await insertWallet();
    const walletB = await insertWallet();
    const txOfA = await insertTransaction(walletA);
    await expect(insertLedgerEntry({ id: txOfA.id, wallet_id: walletB.id })).rejects.toThrow("ledger_transaction_fk");
  });

  test("amount zero é recusado", async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    await expect(
      insertLedgerEntry(tx, { amount: "0.00", balance_after_amount: "100.00" }),
    ).rejects.toThrow("ledger_amount_positive_ck");
  });
});

describe("wallet_ledger_entries: imutabilidade (restrição 5)", () => {
  const entryInDatabase = async () => {
    const wallet = await insertWallet();
    const tx = await insertTransaction(wallet);
    return insertLedgerEntry(tx);
  };

  test("UPDATE é recusado pelo trigger", async () => {
    const entry = await entryInDatabase();
    await expect(sql("update wallet_ledger_entries set amount = 1 where id = ?", [entry.id])).rejects.toThrow(
      "é imutável: UPDATE",
    );
  });

  test("DELETE é recusado pelo trigger", async () => {
    const entry = await entryInDatabase();
    await expect(sql("delete from wallet_ledger_entries where id = ?", [entry.id])).rejects.toThrow(
      "é imutável: DELETE",
    );
  });

  test("TRUNCATE é recusado pelo trigger", async () => {
    await entryInDatabase();
    await expect(sql("truncate wallet_ledger_entries")).rejects.toThrow("é imutável: TRUNCATE");
  });

  test("o lançamento continua intacto depois das tentativas", async () => {
    const entry = await entryInDatabase();
    await sql("update wallet_ledger_entries set amount = 1 where id = ?", [entry.id]).catch(() => {});
    await sql("delete from wallet_ledger_entries where id = ?", [entry.id]).catch(() => {});

    const [row] = await sql("select amount from wallet_ledger_entries where id = ?", [entry.id]);
    expect(row.amount).toBe("30.00");
  });
});

describe("inbox_messages", () => {
  test("a mesma mensagem duas vezes para o mesmo consumidor é recusada", async () => {
    const messageId = `msg-${newId()}`;
    const message = { consumer_name: "wager-consumer", message_id: messageId, payload_hash: "h", received_at: new Date() };
    await insertRow("inbox_messages", message);
    await expect(insertRow("inbox_messages", message)).rejects.toThrow("inbox_messages_pk");
  });

  test("a mesma mensagem para OUTRO consumidor é permitida", async () => {
    const messageId = `msg-${newId()}`;
    const base = { message_id: messageId, payload_hash: "h", received_at: new Date() };
    await insertRow("inbox_messages", { ...base, consumer_name: "consumer-a" });
    await insertRow("inbox_messages", { ...base, consumer_name: "consumer-b" });
  });
});
