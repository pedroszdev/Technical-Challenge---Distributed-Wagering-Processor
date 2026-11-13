import { InvalidPayloadError } from "../application/shared/invalid-payload.error.ts";
import { Money, type MoneyProps } from "../domain/money/money.ts";
import { WagerTransactionKind } from "../domain/wager-transaction/wager-transaction.enums.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WagerTransactionInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
}

export function parseWagerTransactionRequest(body: unknown, idempotencyKey: string | undefined): WagerTransactionInput {
    if(!idempotencyKey) {
        throw new InvalidPayloadError('idempotencyKey é obrigatório')
    }

    if (idempotencyKey.length > 255 ) {
        throw new InvalidPayloadError('idempotencyKey precisa so pode ser ate 255 caracteres')
    }

    if (typeof body !== "object" || body === null) {
        throw new InvalidPayloadError("o body deve ser um objeto JSON");
    }
    const { playerId, walletId, providerId, externalTransactionId, roundId, gameId, kind, money, referenceExternalTransactionId } = body as Record<string, unknown>;

    if (typeof playerId !== "string" || !UUID_PATTERN.test(playerId)) {
        throw new InvalidPayloadError("playerId deve ser um UUID");
    }

    if (typeof walletId !== "string" || !UUID_PATTERN.test(walletId)) {
        throw new InvalidPayloadError("walletId deve ser um UUID");
    }

    if (typeof providerId !== "string" || providerId.length === 0) {
        throw new InvalidPayloadError("providerId deve ser uma string não vazia");
    }

    if (typeof externalTransactionId !== "string" || externalTransactionId.length === 0) {
        throw new InvalidPayloadError("externalTransactionId deve ser uma string não vazia");
    }

    if (typeof roundId !== "string" || roundId.length === 0) {
        throw new InvalidPayloadError("roundId deve ser uma string não vazia");
    }
    if (typeof gameId !== "string" || gameId.length === 0) {
        throw new InvalidPayloadError("gameId deve ser uma string não vazia");
    }

    if (!Object.values(WagerTransactionKind).includes( kind as WagerTransactionKind ) || kind === WagerTransactionKind.Opening ) {
        throw new InvalidPayloadError("kind deve ser um WagerTransaction valido");
    }

    if (typeof money !== "object" || money === null) {
        throw new InvalidPayloadError("money deve ser { amount, currency }");
    }

    const parsedMoney = Money.from(money as MoneyProps);

    if(referenceExternalTransactionId !== undefined && referenceExternalTransactionId !== null && typeof referenceExternalTransactionId !== "string" ) {
        throw new InvalidPayloadError('referenceExternalTransactionId precisa ser string')
    }
   
    return {
        idempotencyKey,
        providerId,
        externalTransactionId,
        playerId,
        walletId,
        roundId,
        gameId,
        kind: kind as WagerTransactionKind,                     
        money: parsedMoney,
        referenceExternalTransactionId: typeof referenceExternalTransactionId === "string" ? referenceExternalTransactionId : undefined,
    };

}
