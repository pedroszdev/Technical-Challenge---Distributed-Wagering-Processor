import type { WagerTransactionInput } from "../../http/wager-transaction.request.ts";

export function canonicalJson(value: unknown): string {

  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }

  if (value !== null && typeof value === "object") {
    const chavesOrdenada = Object.keys(value).sort()
    const partes: string[] = [];
    const obj = value as Record<string, unknown>
    for (let chave of chavesOrdenada) {
        if (obj[chave] === undefined) continue
        partes.push(JSON.stringify(chave) + ":" + canonicalJson(obj[chave]))
    }
    return "{" + partes.join(",") + "}";
  }
  // string, número, booleano, null
  return JSON.stringify(value);
}

export function computePayloadHash(input: WagerTransactionInput): string {
    const businessFields = {
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        playerId: input.playerId,
        walletId: input.walletId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money: input.money.toJSON(),   // ← o Money vira { amount, currency }, já normalizado
        referenceExternalTransactionId: input.referenceExternalTransactionId
    };

    const canonical = canonicalJson(businessFields);

    return new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
}
