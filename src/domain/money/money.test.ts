import { describe, expect, test } from "bun:test";
import { Money } from "./money.ts";
import { CurrencyMismatchError, InvalidMoneyError } from "./money.errors.ts";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const usd = (amount: string) => Money.from({ amount, currency: "USD" });

describe("Money.from: validação de entrada", () => {
  test.each([
    ["25.00", "25.00"],
    ["10", "10.00"],
    ["10.5", "10.50"],
    ["0", "0.00"],
    ["0.01", "0.01"],
    ["999999999999999999.99", "999999999999999999.99"],
  ])("aceita %p e normaliza para %p", (input, expected) => {
    expect(brl(input).toJSON()).toEqual({ amount: expected, currency: "BRL" });
  });

  test.each([
    [""],
    ["abc"],
    ["NaN"],
    ["Infinity"],
    ["-Infinity"],
    ["1e5"],
    ["1E5"],
    ["10.123"],
    ["-5.00"],
    ["+5.00"],
    [" 5.00"],
    ["5.00 "],
    ["5."],
    [".5"],
    ["1,50"],
    ["007.00"],
    ["1000000000000000000.00"], // 19 dígitos inteiros: estoura NUMERIC(20,2)
  ])("rejeita amount %p", (input) => {
    expect(() => brl(input)).toThrow(InvalidMoneyError);
  });

  test("rejeita amount que não é string (ex.: number vindo do JSON)", () => {
    // Simula um payload mal formado: { "amount": 25 }
    const props = { amount: 25, currency: "BRL" } as unknown as { amount: string; currency: string };
    expect(() => Money.from(props)).toThrow(InvalidMoneyError);
  });

  test.each([["brl"], ["BR"], ["BRLL"], [""], ["R$"]])("rejeita currency %p", (currency) => {
    expect(() => Money.from({ amount: "1.00", currency })).toThrow(InvalidMoneyError);
  });
});

describe("Money: aritmética exata", () => {
  test("0.10 + 0.20 = 0.30 (com number daria 0.30000000000000004)", () => {
    expect(brl("0.10").add(brl("0.20")).toJSON().amount).toBe("0.30");
  });

  test("soma e subtração", () => {
    expect(brl("25.00").add(brl("10.50")).toJSON().amount).toBe("35.50");
    expect(brl("100.00").subtract(brl("80.00")).toJSON().amount).toBe("20.00");
  });

  test("somar 0.01 mil vezes dá exatamente 10.00", () => {
    let total = Money.zero("BRL");
    for (let i = 0; i < 1000; i++) total = total.add(brl("0.01"));
    expect(total.toJSON().amount).toBe("10.00");
  });

  test("valores grandes não perdem precisão", () => {
    const result = brl("999999999999999999.98").add(brl("0.01"));
    expect(result.toJSON().amount).toBe("999999999999999999.99");
  });

  test("subtrair pode gerar negativo (internamente); quem proíbe saldo negativo é a Wallet", () => {
    const result = brl("10.00").subtract(brl("25.00"));
    expect(result.isNegative()).toBe(true);
    expect(result.toJSON().amount).toBe("-15.00");
  });

  test("negate inverte o sinal, e negate de zero continua 0.00", () => {
    expect(brl("25.00").negate().toJSON().amount).toBe("-25.00");
    expect(Money.zero("BRL").negate().toJSON().amount).toBe("0.00");
  });
});

describe("Money: imutabilidade", () => {
  test("add/subtract/negate não alteram a instância original", () => {
    const original = brl("100.00");
    original.add(brl("50.00"));
    original.subtract(brl("30.00"));
    original.negate();
    expect(original.toJSON().amount).toBe("100.00");
  });

  test("cada operação devolve uma nova instância", () => {
    const original = brl("100.00");
    expect(original.add(Money.zero("BRL"))).not.toBe(original);
  });
});

describe("Money: conflito de moeda", () => {
  test("add, subtract e isLessThan entre moedas diferentes lançam erro", () => {
    expect(() => brl("1.00").add(usd("1.00"))).toThrow(CurrencyMismatchError);
    expect(() => brl("1.00").subtract(usd("1.00"))).toThrow(CurrencyMismatchError);
    expect(() => brl("1.00").isLessThan(usd("1.00"))).toThrow(CurrencyMismatchError);
  });

  test("equals entre moedas diferentes retorna false (não lança)", () => {
    expect(brl("1.00").equals(usd("1.00"))).toBe(false);
  });
});

describe("Money: comparações", () => {
  test("isZero / isPositive / isNegative", () => {
    expect(Money.zero("BRL").isZero()).toBe(true);
    expect(Money.zero("BRL").isPositive()).toBe(false);
    expect(brl("0.01").isPositive()).toBe(true);
    expect(brl("0.00").subtract(brl("0.01")).isNegative()).toBe(true);
  });

  test("isLessThan", () => {
    expect(brl("80.00").isLessThan(brl("100.00"))).toBe(true);
    expect(brl("100.00").isLessThan(brl("100.00"))).toBe(false);
  });

  test("equals ignora a forma como o valor foi escrito", () => {
    expect(brl("10").equals(brl("10.00"))).toBe(true);
    expect(brl("10.5").equals(brl("10.50"))).toBe(true);
  });
});

describe("Money: serialização", () => {
  test("toJSON funciona com JSON.stringify", () => {
    expect(JSON.stringify({ balance: brl("975") })).toBe(
      '{"balance":{"amount":"975.00","currency":"BRL"}}',
    );
  });

  test("toString", () => {
    expect(brl("25").toString()).toBe("25.00 BRL");
  });
});
