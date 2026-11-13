import { DomainError } from "../../domain/shared/domain-error.ts";

/** Já existe wallet para esse player + moeda (constraint wallets_player_currency_uq). */
export class WalletAlreadyExistsError extends DomainError {
  readonly code = "WALLET_ALREADY_EXISTS";

  constructor(
    readonly playerId: string,
    readonly currency: string,
  ) {
    super(`O player ${playerId} já tem uma wallet em ${currency}`);
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = "WALLET_NOT_FOUND";

  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} não encontrada`);
  }
}
