import { describe, expect, test } from "bun:test";
import { parseWagerTransactionRequest } from "./wager-transaction.request.ts";
import { InvalidPayloadError } from "../application/shared/invalid-payload.error.ts";
import { Money } from "../domain/money/money.ts";
import { InvalidMoneyError } from "../domain/money/money.errors.ts";
import { WagerTransactionKind } from "../domain/wager-transaction/wager-transaction.enums.ts";

const KEY = "provider-a:transaction-123";

/** Body válido do README (seção 9). Cada teste troca só o campo que interessa. */
const validBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  providerId: "provider-a",
  externalTransactionId: "transaction-123",
  playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
  roundId: "round-987",
  gameId: "fortune-chimp",
  kind: "BET",
  money: { amount: "25.00", currency: "BRL" },
  ...overrides,
});

/** Remove um campo do body (para testar "campo ausente"). */
const without = (field: string) => {
  const body = validBody();
  delete body[field];
  return body;
};

const parse = (body: unknown, key: string | undefined = KEY) => parseWagerTransactionRequest(body, key);

describe("parseWagerTransactionRequest: payload válido", () => {
  test("devolve o input tipado, com o Money já construído", () => {
    const input = parse(validBody());

    expect(input).toEqual({
      idempotencyKey: KEY,
      providerId: "provider-a",
      externalTransactionId: "transaction-123",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
      roundId: "round-987",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: expect.anything(),
      referenceExternalTransactionId: undefined,
    });
    // O money é uma instância de Money (não o objeto cru do JSON).
    expect(input.money instanceof Money).toBe(true);
    expect(input.money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
  });

  test("normaliza o valor: '25' vira 25.00", () => {
    const input = parse(validBody({ money: { amount: "25", currency: "BRL" } }));
    expect(input.money.toJSON().amount).toBe("25.00");
  });

  test.each([["BET"], ["WIN"], ["LOSS"], ["REFUND"], ["ROLLBACK"]])("aceita kind %p", (kind) => {
    const input = parse(validBody({ kind, referenceExternalTransactionId: "transaction-100" }));
    expect(input.kind).toBe(kind as WagerTransactionKind);
  });

  test("referência string é mantida", () => {
    const input = parse(validBody({ kind: "REFUND", referenceExternalTransactionId: "transaction-100" }));
    expect(input.referenceExternalTransactionId).toBe("transaction-100");
  });

  test("referência null vira undefined (o domínio usa undefined)", () => {
    const input = parse(validBody({ referenceExternalTransactionId: null }));
    expect(input.referenceExternalTransactionId).toBeUndefined();
  });

  test("Idempotency-Key com exatamente 255 caracteres é aceito", () => {
    expect(() => parse(validBody(), "k".repeat(255))).not.toThrow();
  });

  test("o DTO NÃO checa 'REFUND exige referência': isso é papel do domínio (WagerTransaction.create)", () => {
    expect(() => parse(validBody({ kind: "REFUND" }))).not.toThrow();
  });
});

describe("parseWagerTransactionRequest: Idempotency-Key", () => {
  // Chama a função direto: o helper `parse` tem KEY como valor padrão,
  // e passar `undefined` para um parâmetro com default faz o JS usar o default.
  test.each([
    ["ausente", undefined],
    ["vazio", ""],
  ])("%s → InvalidPayloadError", (_, key) => {
    expect(() => parseWagerTransactionRequest(validBody(), key)).toThrow(InvalidPayloadError);
  });

  test("com mais de 255 caracteres → InvalidPayloadError", () => {
    expect(() => parse(validBody(), "k".repeat(256))).toThrow(InvalidPayloadError);
  });
});

describe("parseWagerTransactionRequest: body", () => {
  test.each([
    ["null", null],
    ["string", "texto"],
    ["number", 42],
  ])("body %s → InvalidPayloadError", (_, body) => {
    expect(() => parse(body)).toThrow(InvalidPayloadError);
  });
});

describe("parseWagerTransactionRequest: UUIDs", () => {
  test.each([["playerId"], ["walletId"]])("%s inválido, ausente ou number → InvalidPayloadError", (field) => {
    expect(() => parse(validBody({ [field]: "abc" }))).toThrow(InvalidPayloadError);
    expect(() => parse(without(field))).toThrow(InvalidPayloadError);
    expect(() => parse(validBody({ [field]: 123 }))).toThrow(InvalidPayloadError);
  });

  test("UUID em maiúsculas é aceito", () => {
    expect(() => parse(validBody({ walletId: "0192F291-27DD-7D3F-8071-5F8685DEEF37" }))).not.toThrow();
  });
});

describe("parseWagerTransactionRequest: strings obrigatórias", () => {
  test.each([["providerId"], ["externalTransactionId"], ["roundId"], ["gameId"]])(
    "%s vazio, ausente ou number → InvalidPayloadError",
    (field) => {
      expect(() => parse(validBody({ [field]: "" }))).toThrow(InvalidPayloadError);
      expect(() => parse(without(field))).toThrow(InvalidPayloadError);
      expect(() => parse(validBody({ [field]: 123 }))).toThrow(InvalidPayloadError);
    },
  );

  test("a mensagem de erro diz QUAL campo está errado", () => {
    expect(() => parse(validBody({ roundId: "" }))).toThrow(/roundId/);
  });
});

describe("parseWagerTransactionRequest: kind", () => {
  test("OPENING é interno: não pode vir de fora (seção 6.3)", () => {
    expect(() => parse(validBody({ kind: "OPENING" }))).toThrow(InvalidPayloadError);
  });

  test.each([["JACKPOT"], ["bet"], [""], [null], [1]])("kind %p → InvalidPayloadError", (kind) => {
    expect(() => parse(validBody({ kind }))).toThrow(InvalidPayloadError);
  });

  test("kind ausente → InvalidPayloadError", () => {
    expect(() => parse(without("kind"))).toThrow(InvalidPayloadError);
  });
});

describe("parseWagerTransactionRequest: money", () => {
  test.each([
    ["ausente", undefined],
    ["null", null],
    ["string", "25.00"],
  ])("money %s → InvalidPayloadError (e não um TypeError/500)", (_, money) => {
    const body = money === undefined ? without("money") : validBody({ money });
    expect(() => parse(body)).toThrow(InvalidPayloadError);
  });

  test.each([
    ["10.123", "BRL"],
    ["-5.00", "BRL"],
    ["1e5", "BRL"],
    ["25.00", "brl"],
  ])("amount %p / currency %p → InvalidMoneyError (validação do Money.from)", (amount, currency) => {
    expect(() => parse(validBody({ money: { amount, currency } }))).toThrow(InvalidMoneyError);
  });

  test("amount como number → InvalidMoneyError", () => {
    expect(() => parse(validBody({ money: { amount: 25, currency: "BRL" } }))).toThrow(InvalidMoneyError);
  });
});

describe("parseWagerTransactionRequest: referenceExternalTransactionId", () => {
  test.each([
    ["number", 123],
    ["zero (falsy: pegaria o bug do `&&` com truthy)", 0],
    ["false (falsy)", false],
    ["objeto", { id: "x" }],
  ])("%s → InvalidPayloadError", (_, reference) => {
    expect(() => parse(validBody({ referenceExternalTransactionId: reference }))).toThrow(InvalidPayloadError);
  });
});
