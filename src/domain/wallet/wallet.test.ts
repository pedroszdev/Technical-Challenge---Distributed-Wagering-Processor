import { describe, expect, test } from "bun:test";
import { Wallet } from "./wallet.ts";
import { InsufficientFundsError, InvalidAmountError } from "./wallet.errors.ts";
import { Money } from "../money/money.ts";
import { CurrencyMismatchError } from "../money/money.errors.ts";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const usd = (amount: string) => Money.from({ amount, currency: "USD" });

/** Abre uma wallet nova em BRL com o saldo informado. */
const openWallet = (initial = "100.00") =>
  Wallet.open({ id: "wallet-1", playerId: "player-1", initialBalance: brl(initial) });

/** Data fixa no passado: serve para provar que o updatedAt muda depois de uma operação. */
const PAST = new Date("2026-01-01T00:00:00.000Z");

/** Wallet "vinda do banco", com version e datas que não são as de uma wallet nova. */
const rehydratedWallet = (balance = "100.00", version = 7) =>
  Wallet.rehydrate({
    id: "wallet-1",
    playerId: "player-1",
    currency: "BRL",
    balance: brl(balance),
    version,
    createdAt: PAST,
    updatedAt: PAST,
  });

describe("Wallet.open", () => {
  test("nasce com version 1 e o saldo inicial", () => {
    const wallet = openWallet("1000.00");

    expect(wallet.id).toBe("wallet-1");
    expect(wallet.playerId).toBe("player-1");
    expect(wallet.version).toBe(1);
    expect(wallet.balance.equals(brl("1000.00"))).toBe(true);
  });

  test("a moeda da wallet vem do saldo inicial", () => {
    const wallet = Wallet.open({ id: "w", playerId: "p", initialBalance: usd("10.00") });
    expect(wallet.currency).toBe("USD");
  });

  test("aceita saldo inicial zero", () => {
    const wallet = openWallet("0.00");
    expect(wallet.balance.isZero()).toBe(true);
    expect(wallet.version).toBe(1);
  });

  test("rejeita saldo inicial negativo", () => {
    // Money.from não aceita negativo, então geramos um por subtração.
    const negative = Money.zero("BRL").subtract(brl("1.00"));
    expect(() => Wallet.open({ id: "w", playerId: "p", initialBalance: negative })).toThrow(
      InvalidAmountError,
    );
  });
});

describe("Wallet.rehydrate", () => {
  test("reconstrói exatamente o estado salvo, sem resetar version nem datas", () => {
    const wallet = rehydratedWallet("250.00", 7);

    expect(wallet.version).toBe(7);
    expect(wallet.balance.equals(brl("250.00"))).toBe(true);
    expect(wallet.createdAt).toBe(PAST);
    expect(wallet.updatedAt).toBe(PAST);
  });
});

describe("Wallet.debit", () => {
  test("diminui o saldo e incrementa a version", () => {
    const wallet = openWallet("100.00");

    wallet.debit(brl("30.00"));

    expect(wallet.balance.equals(brl("70.00"))).toBe(true);
    expect(wallet.version).toBe(2);
  });

  test("retorna o saldo antes e depois (para montar o ledger)", () => {
    const wallet = openWallet("100.00");

    const { before, after } = wallet.debit(brl("30.00"));

    expect(before.equals(brl("100.00"))).toBe(true);
    expect(after.equals(brl("70.00"))).toBe(true);
    // Invariante do ledger: antes - valor = depois
    expect(before.subtract(brl("30.00")).equals(after)).toBe(true);
  });

  test("pode debitar o saldo inteiro (saldo final 0.00)", () => {
    const wallet = openWallet("100.00");

    wallet.debit(brl("100.00"));

    expect(wallet.balance.isZero()).toBe(true);
  });

  test("débitos seguidos incrementam a version a cada vez", () => {
    const wallet = openWallet("100.00");

    wallet.debit(brl("10.00"));
    wallet.debit(brl("10.00"));
    wallet.debit(brl("10.00"));

    expect(wallet.version).toBe(4);
    expect(wallet.balance.equals(brl("70.00"))).toBe(true);
  });

  test("atualiza o updatedAt", () => {
    const wallet = rehydratedWallet();

    wallet.debit(brl("10.00"));

    expect(wallet.updatedAt.getTime()).toBeGreaterThan(PAST.getTime());
  });

  test("saldo insuficiente lança InsufficientFundsError", () => {
    const wallet = openWallet("20.00");
    expect(() => wallet.debit(brl("80.00"))).toThrow(InsufficientFundsError);
  });

  test("débito de zero lança InvalidAmountError", () => {
    const wallet = openWallet("100.00");
    expect(() => wallet.debit(brl("0.00"))).toThrow(InvalidAmountError);
  });

  test("moeda diferente lança CurrencyMismatchError", () => {
    const wallet = openWallet("100.00");
    expect(() => wallet.debit(usd("10.00"))).toThrow(CurrencyMismatchError);
  });
});

describe("Wallet.credit", () => {
  test("aumenta o saldo e incrementa a version", () => {
    const wallet = openWallet("100.00");

    wallet.credit(brl("50.00"));

    expect(wallet.balance.equals(brl("150.00"))).toBe(true);
    expect(wallet.version).toBe(2);
  });

  test("retorna o saldo antes e depois (para montar o ledger)", () => {
    const wallet = openWallet("100.00");

    const { before, after } = wallet.credit(brl("50.00"));

    expect(before.equals(brl("100.00"))).toBe(true);
    expect(after.equals(brl("150.00"))).toBe(true);
    // Invariante do ledger: antes + valor = depois
    expect(before.add(brl("50.00")).equals(after)).toBe(true);
  });

  test("atualiza o updatedAt", () => {
    const wallet = rehydratedWallet();

    wallet.credit(brl("10.00"));

    expect(wallet.updatedAt.getTime()).toBeGreaterThan(PAST.getTime());
  });

  test("crédito de zero lança InvalidAmountError", () => {
    const wallet = openWallet("100.00");
    expect(() => wallet.credit(brl("0.00"))).toThrow(InvalidAmountError);
  });

  test("moeda diferente lança CurrencyMismatchError", () => {
    const wallet = openWallet("100.00");
    expect(() => wallet.credit(usd("10.00"))).toThrow(CurrencyMismatchError);
  });
});

describe("Wallet: operação recusada não altera nada", () => {
  // Se a operação falha, o estado tem que ficar exatamente como estava.
  // Senão, um retry depois de um erro poderia encontrar a wallet "meio alterada".
  test.each([
    ["saldo insuficiente", (w: Wallet) => w.debit(brl("500.00"))],
    ["débito de zero", (w: Wallet) => w.debit(brl("0.00"))],
    ["débito em outra moeda", (w: Wallet) => w.debit(usd("10.00"))],
    ["crédito de zero", (w: Wallet) => w.credit(brl("0.00"))],
    ["crédito em outra moeda", (w: Wallet) => w.credit(usd("10.00"))],
  ])("%s: saldo, version e updatedAt continuam iguais", (_, operation) => {
    const wallet = rehydratedWallet("100.00", 7);

    expect(() => operation(wallet)).toThrow();

    expect(wallet.balance.equals(brl("100.00"))).toBe(true);
    expect(wallet.version).toBe(7);
    expect(wallet.updatedAt).toBe(PAST);
  });
});

describe("Wallet: cenário da seção 8 (em memória, sem concorrência)", () => {
  // Este teste só prova a REGRA. A versão com concorrência real (duas apostas ao
  // mesmo tempo, em instâncias diferentes) vai precisar do Postgres e vem depois.
  test("saldo 100.00, duas apostas de 80.00: a segunda é recusada e o saldo fica 20.00", () => {
    const wallet = openWallet("100.00");

    wallet.debit(brl("80.00"));
    expect(() => wallet.debit(brl("80.00"))).toThrow(InsufficientFundsError);

    expect(wallet.balance.equals(brl("20.00"))).toBe(true);
    expect(wallet.version).toBe(2);
  });

  test("débito seguido de crédito: version 3 e saldo correto", () => {
    const wallet = openWallet("100.00");

    wallet.debit(brl("25.00"));
    wallet.credit(brl("50.00"));

    expect(wallet.version).toBe(3);
    expect(wallet.balance.equals(brl("125.00"))).toBe(true);
  });
});
