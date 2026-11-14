import { DomainError } from "../../domain/shared/domain-error.ts";

export class IdempotencyConflictError extends DomainError {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor(
    readonly idempotencyKey: string,
    readonly existingTransactionId: string,
  ) {
    super(`Idempotency-Key "${idempotencyKey}" já foi usada pela transação ${existingTransactionId} com um payload diferente`);
  }
}

export class WalletPlayerMismatchError extends DomainError {
  readonly code = "WALLET_PLAYER_MISMATCH";

  constructor(
    readonly walletId: string,
    readonly playerId: string,
  ) {
    super(`O player ${playerId} do pedido não é dono da wallet ${walletId}`);
  }
}