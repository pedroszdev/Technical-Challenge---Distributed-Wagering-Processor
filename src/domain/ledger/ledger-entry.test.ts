import { describe, expect, test } from "bun:test";
import { WalletLedgerEntry } from "./ledger-entry.ts";
import { LedgerDirection } from "./ledger-direction.ts";
import { UnbalancedLedgerEntryError } from "./ledger-entry.errors.ts";
import { Money } from "../money/money.ts";
import { CurrencyMismatchError } from "../money/money.errors.ts";
import { InvalidAmountError } from "../wallet/wallet.errors.ts";
import { Wallet } from "../wallet/wallet.ts";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const usd = (amount: string) => Money.from({ amount, currency: "USD" });

const PAST = new Date("2026-01-01T00:00:00.000Z");

/** Props válidas de um DEBIT: 100.00 - 30.00 = 70.00. Cada teste muda só o que precisa. */
const validDebit = () => ({
  id: "entry-1",
  walletId: "wallet-1",
  transactionId: "tx-1",
  direction: LedgerDirection.Debit,
  money: brl("30.00"),
  balanceBefore: brl("100.00"),
  balanceAfter: brl("70.00"),
});

/** Props válidas de um CREDIT: 100.00 + 50.00 = 150.00. */
const validCredit = () => ({
  id: "entry-2",
  walletId: "wallet-1",
  transactionId: "tx-2",
  direction: LedgerDirection.Credit,
  money: brl("50.00"),
  balanceBefore: brl("100.00"),
  balanceAfter: brl("150.00"),
});

describe("WalletLedgerEntry.create: casos válidos", () => {
  test("DEBIT 100.00 - 30.00 = 70.00 preenche todos os campos", () => {
    const entry = WalletLedgerEntry.create(validDebit());

    expect(entry.id).toBe("entry-1");
    expect(entry.walletId).toBe("wallet-1");
    expect(entry.transactionId).toBe("tx-1");
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.money.equals(brl("30.00"))).toBe(true);
    expect(entry.balanceBefore.equals(brl("100.00"))).toBe(true);
    expect(entry.balanceAfter.equals(brl("70.00"))).toBe(true);
  });

  test("CREDIT 100.00 + 50.00 = 150.00", () => {
    const entry = WalletLedgerEntry.create(validCredit());
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceAfter.equals(brl("150.00"))).toBe(true);
  });

  test("DEBIT do saldo inteiro: 100.00 - 100.00 = 0.00", () => {
    const entry = WalletLedgerEntry.create({
      ...validDebit(),
      money: brl("100.00"),
      balanceAfter: brl("0.00"),
    });
    expect(entry.balanceAfter.isZero()).toBe(true);
  });

  test("CREDIT a partir de saldo zero (ex.: lançamento OPENING)", () => {
    const entry = WalletLedgerEntry.create({
      ...validCredit(),
      money: brl("1000.00"),
      balanceBefore: Money.zero("BRL"),
      balanceAfter: brl("1000.00"),
    });
    expect(entry.balanceAfter.equals(brl("1000.00"))).toBe(true);
  });

  test("createdAt é preenchido com a data atual", () => {
    const before = Date.now();
    const entry = WalletLedgerEntry.create(validDebit());
    const after = Date.now();

    expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(entry.createdAt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("WalletLedgerEntry.create: conta que não fecha", () => {
  test("DEBIT 100.00 - 30.00 com balanceAfter 80.00", () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validDebit(), balanceAfter: brl("80.00") }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  test("CREDIT 100.00 + 50.00 com balanceAfter 140.00", () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validCredit(), balanceAfter: brl("140.00") }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  test("direção trocada: DEBIT com a conta de um CREDIT (100.00 → 130.00)", () => {
    // Pega o bug de somar quando deveria subtrair.
    expect(() =>
      WalletLedgerEntry.create({ ...validDebit(), balanceAfter: brl("130.00") }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  test("direção trocada: CREDIT com a conta de um DEBIT (100.00 → 50.00)", () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validCredit(), balanceAfter: brl("50.00") }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  test("o erro carrega o código estável LEDGER_ENTRY_UNBALANCED", () => {
    try {
      WalletLedgerEntry.create({ ...validDebit(), balanceAfter: brl("80.00") });
      throw new Error("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(UnbalancedLedgerEntryError);
      expect((error as UnbalancedLedgerEntryError).code).toBe("LEDGER_ENTRY_UNBALANCED");
    }
  });
});

describe("WalletLedgerEntry.create: valores inválidos", () => {
  test("money zero lança InvalidAmountError", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...validDebit(),
        money: brl("0.00"),
        balanceAfter: brl("100.00"),
      }),
    ).toThrow(InvalidAmountError);
  });

  test("money negativo lança InvalidAmountError", () => {
    // Um "débito negativo" seria um crédito disfarçado: a direção é que diz se entra ou sai.
    const negative = Money.zero("BRL").subtract(brl("30.00"));
    expect(() =>
      WalletLedgerEntry.create({
        ...validDebit(),
        money: negative,
        balanceAfter: brl("130.00"),
      }),
    ).toThrow(InvalidAmountError);
  });

  test("balanceAfter negativo lança InvalidAmountError (mesmo com a conta fechando)", () => {
    // 20.00 - 30.00 = -10.00: a conta fecha, mas saldo negativo é proibido.
    expect(() =>
      WalletLedgerEntry.create({
        ...validDebit(),
        balanceBefore: brl("20.00"),
        balanceAfter: Money.zero("BRL").subtract(brl("10.00")),
      }),
    ).toThrow(InvalidAmountError);
  });
});

describe("WalletLedgerEntry.create: moedas", () => {
  test("money em USD e saldos em BRL", () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validDebit(), money: usd("30.00") }),
    ).toThrow(/esperado BRL, recebido USD/);
  });

  test("balanceAfter em USD e o resto em BRL", () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validDebit(), balanceAfter: usd("70.00") }),
    ).toThrow(/esperado BRL, recebido USD/);
  });

  test("o erro lançado é CurrencyMismatchError", () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validDebit(), money: usd("30.00") }),
    ).toThrow(CurrencyMismatchError);
  });
});

describe("WalletLedgerEntry.isBalanced", () => {
  test("lançamento criado pelo create é balanceado", () => {
    expect(WalletLedgerEntry.create(validDebit()).isBalanced()).toBe(true);
    expect(WalletLedgerEntry.create(validCredit()).isBalanced()).toBe(true);
  });

  test("lançamento desbalanceado vindo do banco: rehydrate aceita, isBalanced detecta", () => {
    // Simula um registro corrompido no banco. É assim que a reconciliação acha divergências.
    const corrupted = WalletLedgerEntry.rehydrate({
      ...validDebit(),
      balanceAfter: brl("80.00"),
      createdAt: PAST,
    });

    expect(corrupted.isBalanced()).toBe(false);
  });
});

describe("WalletLedgerEntry.rehydrate", () => {
  test("reconstrói todos os campos, inclusive um createdAt antigo", () => {
    const entry = WalletLedgerEntry.rehydrate({ ...validDebit(), createdAt: PAST });

    expect(entry.id).toBe("entry-1");
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceAfter.equals(brl("70.00"))).toBe(true);
    expect(entry.createdAt).toBe(PAST);
  });
});

describe("WalletLedgerEntry: imutabilidade", () => {
  test("campos são readonly (verificado pelo typecheck)", () => {
    const entry = WalletLedgerEntry.create(validDebit());

    // Se alguém remover o `readonly`, estas linhas deixam de ser erro de tipo,
    // o @ts-expect-error fica "sem uso" e o `bun run typecheck` falha.
    // @ts-expect-error: money é readonly
    entry.money = brl("1.00");
    // @ts-expect-error: balanceAfter é readonly
    entry.balanceAfter = brl("1.00");
    // @ts-expect-error: direction é readonly
    entry.direction = LedgerDirection.Credit;
  });
});

describe("WalletLedgerEntry + Wallet: integração", () => {
  test("o { before, after } do debit vira um lançamento DEBIT balanceado", () => {
    const wallet = Wallet.open({ id: "wallet-1", playerId: "p", initialBalance: brl("100.00") });

    const { before, after } = wallet.debit(brl("30.00"));
    const entry = WalletLedgerEntry.create({
      id: "entry-1",
      walletId: wallet.id,
      transactionId: "tx-1",
      direction: LedgerDirection.Debit,
      money: brl("30.00"),
      balanceBefore: before,
      balanceAfter: after,
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceAfter.equals(wallet.balance)).toBe(true);
  });

  test("o { before, after } do credit vira um lançamento CREDIT balanceado", () => {
    const wallet = Wallet.open({ id: "wallet-1", playerId: "p", initialBalance: brl("100.00") });

    const { before, after } = wallet.credit(brl("50.00"));
    const entry = WalletLedgerEntry.create({
      id: "entry-2",
      walletId: wallet.id,
      transactionId: "tx-2",
      direction: LedgerDirection.Credit,
      money: brl("50.00"),
      balanceBefore: before,
      balanceAfter: after,
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceAfter.equals(wallet.balance)).toBe(true);
  });
});
