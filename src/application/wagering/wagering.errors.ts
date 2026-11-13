import { DomainError } from "../../domain/shared/domain-error";

export class IdempotencyConflictError extends DomainError {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor(
    readonly idempotencyKey: string,
    readonly existingTransactionId: string,
  ) {
    super(`Idempotency-Key "${idempotencyKey}" já foi usada pela transação ${existingTransactionId} com um payload diferente`);
  }
}
