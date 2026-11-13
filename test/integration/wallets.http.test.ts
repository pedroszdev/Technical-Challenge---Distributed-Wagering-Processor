import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestApp, type TestApp } from "./support/app.ts";
import { closeTestOrm, sql } from "./support/database.ts";
import { assertLedgerMatchesBalance } from "./support/ledger.ts";
import { newId } from "./support/rows.ts";

/**
 * POST/GET /wallets de ponta a ponta: HTTP real -> Nest -> use case -> Postgres real.
 * Sem mocks: é o mesmo AppModule que roda em produção.
 */

let api: TestApp;

beforeAll(async () => {
  api = await startTestApp();
});
afterAll(async () => {
  await api.close();
  await closeTestOrm();
});

const createWallet = (playerId: string, amount: string, currency = "BRL") =>
  api.post("/wallets", { playerId, initialBalance: { amount, currency } });

describe("POST /wallets", () => {
  test("saldo 1000.00: 201 + OPENING PROCESSED + lançamento CREDIT 0.00 → 1000.00, tudo junto", async () => {
    const playerId = newId();

    const res = await createWallet(playerId, "1000.00");

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      playerId,
      balance: { amount: "1000.00", currency: "BRL" },
      version: 1,
    });

    const transactions = await sql(
      "select kind, status, amount, balance_after_amount from wager_transactions where wallet_id = ?",
      [res.body.id],
    );
    expect(transactions).toEqual([
      { kind: "OPENING", status: "PROCESSED", amount: "1000.00", balance_after_amount: "1000.00" },
    ]);

    const entries = await sql(
      "select direction, amount, balance_before_amount, balance_after_amount from wallet_ledger_entries where wallet_id = ?",
      [res.body.id],
    );
    expect(entries).toEqual([
      { direction: "CREDIT", amount: "1000.00", balance_before_amount: "0.00", balance_after_amount: "1000.00" },
    ]);

    await assertLedgerMatchesBalance(res.body.id);
  });

  test("saldo 0.00: 201 e NENHUMA transação ou lançamento", async () => {
    const res = await createWallet(newId(), "0.00");

    expect(res.status).toBe(201);
    const [{ count: txCount }] = await sql("select count(*)::int as count from wager_transactions where wallet_id = ?", [res.body.id]);
    const [{ count: entryCount }] = await sql("select count(*)::int as count from wallet_ledger_entries where wallet_id = ?", [res.body.id]);
    expect(txCount).toBe(0);
    expect(entryCount).toBe(0);

    await assertLedgerMatchesBalance(res.body.id);
  });

  test("valor sem casas decimais é normalizado: '10' → '10.00'", async () => {
    const res = await createWallet(newId(), "10");
    expect(res.status).toBe(201);
    expect(res.body.balance).toEqual({ amount: "10.00", currency: "BRL" });
  });

  test("mesmo player e moeda de novo: 409 WALLET_ALREADY_EXISTS", async () => {
    const playerId = newId();
    await createWallet(playerId, "100.00");

    const res = await createWallet(playerId, "5.00");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("WALLET_ALREADY_EXISTS");
  });

  test("mesmo player em outra moeda: 201", async () => {
    const playerId = newId();
    await createWallet(playerId, "100.00", "BRL");

    const res = await createWallet(playerId, "10.00", "USD");

    expect(res.status).toBe(201);
    expect(res.body.balance.currency).toBe("USD");
  });

  test("CONCORRÊNCIA: 10 POSTs iguais em paralelo → exatamente 1 wallet criada", async () => {
    const playerId = newId();

    const results = await Promise.all(Array.from({ length: 10 }, () => createWallet(playerId, "100.00")));

    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);

    const wallets = await sql("select id from wallets where player_id = ?", [playerId]);
    expect(wallets).toHaveLength(1);
    // As 9 tentativas que falharam não deixaram OPENING nem lançamento "órfãos".
    const [{ count }] = await sql("select count(*)::int as count from wager_transactions where player_id = ?", [playerId]);
    expect(count).toBe(1);

    await assertLedgerMatchesBalance(wallets[0].id);
  });

  test.each([
    ["10.123", "INVALID_MONEY"],
    ["-5.00", "INVALID_MONEY"],
    ["1e5", "INVALID_MONEY"],
    ["", "INVALID_MONEY"],
  ])("amount %p: 400 %s", async (amount, code) => {
    const res = await createWallet(newId(), amount);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
  });

  test("amount como number (25): 400 INVALID_MONEY", async () => {
    const res = await api.post("/wallets", { playerId: newId(), initialBalance: { amount: 25, currency: "BRL" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_MONEY");
  });

  test.each([
    ["playerId inválido", { playerId: "abc", initialBalance: { amount: "1.00", currency: "BRL" } }],
    ["sem initialBalance", { playerId: Bun.randomUUIDv7() }],
    ["body não é objeto", ["isso", "é", "um", "array"]],
  ])("%s: 400 INVALID_PAYLOAD", async (_, body) => {
    const res = await api.post("/wallets", body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PAYLOAD");
  });

  test("moeda fora do ISO-4217: 400 INVALID_MONEY", async () => {
    const res = await createWallet(newId(), "1.00", "brl");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_MONEY");
  });
});

describe("GET /wallets/:walletId", () => {
  test("wallet existente: 200 com o mesmo formato do POST", async () => {
    const created = await createWallet(newId(), "250.00");

    const res = await api.get(`/wallets/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  test("wallet inexistente: 404 WALLET_NOT_FOUND", async () => {
    const res = await api.get(`/wallets/${newId()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("WALLET_NOT_FOUND");
  });

  test("id que não é UUID: 400 INVALID_PAYLOAD (e não 500 do Postgres)", async () => {
    const res = await api.get("/wallets/abc");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PAYLOAD");
  });
});
