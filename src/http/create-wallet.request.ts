import { InvalidPayloadError } from "../application/shared/invalid-payload.error.ts";
import type { CreateWalletInput } from "../application/wallet/create-wallet.use-case.ts";
import { Money, type MoneyProps } from "../domain/money/money.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O DTO do POST /wallets: recebe o body cru (unknown) e devolve dados tipados,
 * ou lança InvalidPayloadError / InvalidMoneyError.
 *
 * É uma função comum (e não um ValidationPipe) para poder ser reaproveitada fora
 * do HTTP. A validação do dinheiro é toda delegada ao Money.from().
 */
export function parseCreateWalletRequest(body: unknown): CreateWalletInput {
  if (typeof body !== "object" || body === null) {
    throw new InvalidPayloadError("o body deve ser um objeto JSON");
  }
  const { playerId, initialBalance } = body as Record<string, unknown>;

  if (typeof playerId !== "string" || !UUID_PATTERN.test(playerId)) {
    throw new InvalidPayloadError("playerId deve ser um UUID");
  }
  if (typeof initialBalance !== "object" || initialBalance === null) {
    throw new InvalidPayloadError("initialBalance deve ser { amount, currency }");
  }

  return {
    playerId: playerId.toLowerCase(),
    initialBalance: Money.from(initialBalance as MoneyProps),
  };
}
