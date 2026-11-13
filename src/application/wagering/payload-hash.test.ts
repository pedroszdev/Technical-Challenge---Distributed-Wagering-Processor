import { describe, expect, test } from "bun:test";
import { canonicalJson, computePayloadHash } from "./payload-hash.ts";
import type { WagerTransactionInput } from "../../http/wager-transaction.request.ts";
import { Money } from "../../domain/money/money.ts";
import { WagerTransactionKind } from "../../domain/wager-transaction/wager-transaction.enums.ts";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

/** Input válido de uma BET (já passou pelo parser). Cada teste troca só o que precisa. */
const validInput = (overrides: Partial<WagerTransactionInput> = {}): WagerTransactionInput => ({
  idempotencyKey: "provider-a:transaction-123",
  providerId: "provider-a",
  externalTransactionId: "transaction-123",
  playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
  roundId: "round-987",
  gameId: "fortune-chimp",
  kind: WagerTransactionKind.Bet,
  money: brl("25.00"),
  referenceExternalTransactionId: undefined,
  ...overrides,
});

describe("canonicalJson", () => {
  test("a ordem das chaves não importa: {b, a} e {a, b} viram o mesmo texto", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test("valores diferentes geram textos diferentes (pegaria o bug do for...in)", () => {
    expect(canonicalJson({ a: 1, b: 999 })).not.toBe(canonicalJson({ a: 1, b: 1 }));
  });

  test("objetos aninhados também ficam ordenados (recursão)", () => {
    expect(canonicalJson({ money: { currency: "BRL", amount: "25.00" } })).toBe(
      '{"money":{"amount":"25.00","currency":"BRL"}}',
    );
  });

  test("arrays MANTÊM a ordem (a ordem de um array tem significado)", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  test("objetos dentro de arrays são ordenados", () => {
    expect(canonicalJson([{ z: 1, a: 2 }])).toBe('[{"a":2,"z":1}]');
  });

  test("chaves com valor undefined são ignoradas", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  test("null é mantido (é diferente de ausente)", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  test("sem espaços em lugar nenhum", () => {
    expect(canonicalJson({ a: [1, { b: "x y" }] })).toBe('{"a":[1,{"b":"x y"}]}');
  });

  test("primitivos e caracteres especiais usam o escape padrão do JSON", () => {
    expect(canonicalJson("texto")).toBe('"texto"');
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({ 'a"b': "linha\nnova" })).toBe('{"a\\"b":"linha\\nnova"}');
  });

  test("NÃO modifica o valor recebido (pegaria o bug do array alterado)", () => {
    const original = [{ z: 1, a: 2 }, { y: [3, 2, 1] }];
    const copy = structuredClone(original);

    canonicalJson(original);

    expect(original).toEqual(copy);
    expect(Object.keys(original[0]!)).toEqual(["z", "a"]); // a ordem original continua
  });

  test("o resultado é JSON válido e volta ao mesmo valor", () => {
    const value = { b: [1, { d: "x", c: null }], a: "y" };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });
});

describe("computePayloadHash", () => {
  test("é um SHA-256 em hexadecimal (64 caracteres)", () => {
    expect(computePayloadHash(validInput())).toMatch(/^[0-9a-f]{64}$/);
  });

  test("é determinístico: o mesmo input gera sempre o mesmo hash", () => {
    expect(computePayloadHash(validInput())).toBe(computePayloadHash(validInput()));
  });

  test("é o SHA-256 do JSON canônico dos campos de negócio (o algoritmo documentado)", () => {
    // Montado à mão, em ordem alfabética, para provar exatamente o que entra no hash.
    const expectedCanonical =
      '{"externalTransactionId":"transaction-123",' +
      '"gameId":"fortune-chimp",' +
      '"kind":"BET",' +
      '"money":{"amount":"25.00","currency":"BRL"},' +
      '"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",' +
      '"providerId":"provider-a",' +
      '"roundId":"round-987",' +
      '"walletId":"0192f291-27dd-7d3f-8071-5f8685deef37"}';
    const expectedHash = new Bun.CryptoHasher("sha256").update(expectedCanonical).digest("hex");

    expect(computePayloadHash(validInput())).toBe(expectedHash);
  });

  test("o Idempotency-Key NÃO entra no hash (é header, não negócio)", () => {
    expect(computePayloadHash(validInput({ idempotencyKey: "outra-key" }))).toBe(
      computePayloadHash(validInput()),
    );
  });

  test("'25' e '25.00' são o mesmo valor: mesmo hash (money normalizado)", () => {
    expect(computePayloadHash(validInput({ money: brl("25") }))).toBe(
      computePayloadHash(validInput({ money: brl("25.00") })),
    );
  });

  test.each<[string, Partial<WagerTransactionInput>]>([
    ["amount", { money: brl("250.00") }],
    ["currency", { money: Money.from({ amount: "25.00", currency: "USD" }) }],
    ["kind", { kind: WagerTransactionKind.Win }],
    ["providerId", { providerId: "provider-b" }],
    ["externalTransactionId", { externalTransactionId: "transaction-999" }],
    ["playerId", { playerId: "0192f28f-5dc0-7d58-bdb2-000000000000" }],
    ["walletId", { walletId: "0192f291-27dd-7d3f-8071-000000000000" }],
    ["roundId", { roundId: "round-1" }],
    ["gameId", { gameId: "outro-jogo" }],
  ])("mudar %s muda o hash (vira CONFLITO, não replay)", (_, override) => {
    expect(computePayloadHash(validInput(override))).not.toBe(computePayloadHash(validInput()));
  });

  test("referência presente vs. ausente geram hashes diferentes", () => {
    const withReference = validInput({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "transaction-100",
    });
    const withoutReference = validInput({ kind: WagerTransactionKind.Refund });

    expect(computePayloadHash(withReference)).not.toBe(computePayloadHash(withoutReference));
  });

  test("referências diferentes geram hashes diferentes", () => {
    const refund = (reference: string) =>
      validInput({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: reference });

    expect(computePayloadHash(refund("transaction-100"))).not.toBe(computePayloadHash(refund("transaction-101")));
  });
});
