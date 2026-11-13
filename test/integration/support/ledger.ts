import { expect } from "bun:test";
import { LedgerDirection } from "../../../src/domain/ledger/ledger-direction.ts";
import { Money } from "../../../src/domain/money/money.ts";
import { getConnection } from "./database.ts";

/**
 * A INVARIANTE FINAL do README (seção 13), para usar no fim de todo teste:
 *
 *     wallet.balance == saldo reconstruído pelo ledger
 *
 * Além da soma, confere a CORRENTE: cada lançamento começa no saldo em que o
 * anterior terminou (balance_before[n] == balance_after[n-1]). Um lançamento
 * "perdido" ou duplicado quebra a corrente mesmo que a soma feche por acaso.
 */
export async function assertLedgerMatchesBalance(walletId: string): Promise<void> {
  const conn = await getConnection();

  const [wallet] = await conn.execute<{ balance_amount: string; currency: string }[]>(
    "select balance_amount, currency from wallets where id = ?",
    [walletId],
  );
  expect(wallet, `wallet ${walletId} não existe`).toBeDefined();
  const currency = wallet!.currency;
  const money = (amount: string) => Money.from({ amount, currency });

  // UUID v7 é ordenado pelo tempo: ordenar por id = ordem de criação.
  const entries = await conn.execute<
    { direction: string; amount: string; balance_before_amount: string; balance_after_amount: string }[]
  >(
    `select direction, amount, balance_before_amount, balance_after_amount
       from wallet_ledger_entries where wallet_id = ? order by id`,
    [walletId],
  );

  let reconstructed = Money.zero(currency);
  for (const [index, entry] of entries.entries()) {
    expect(
      money(entry.balance_before_amount).equals(reconstructed),
      `lançamento #${index}: balance_before ${entry.balance_before_amount} ≠ saldo anterior ${reconstructed}`,
    ).toBe(true);

    reconstructed =
      entry.direction === LedgerDirection.Credit
        ? reconstructed.add(money(entry.amount))
        : reconstructed.subtract(money(entry.amount));

    expect(money(entry.balance_after_amount).equals(reconstructed)).toBe(true);
  }

  expect(
    money(wallet!.balance_amount).equals(reconstructed),
    `saldo da wallet ${wallet!.balance_amount} ≠ saldo reconstruído pelo ledger ${reconstructed}`,
  ).toBe(true);
}
