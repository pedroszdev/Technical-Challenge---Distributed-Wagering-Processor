import { DomainError } from "../../domain/shared/domain-error.ts";

export class ConcurrentWalletUpdateError extends DomainError {
  readonly code = "CONCURRENT_UPDATE";
  constructor(readonly walletId: string) {
    super(`A wallet ${walletId} foi alterada por outra operação; tente novamente`);
  }
}
