import { DomainError } from "../shared/domain-error.ts";
import type { WagerTransactionKind, WagerTransactionStatus } from "./wager-transaction.enums.ts";

export class MissingReferenceError extends DomainError {
  readonly code = "MISSING_REFERENCE";

  constructor(readonly kind: WagerTransactionKind) {
    super(`${kind} exige uma transação de referência`);
  }
}

export class UnexpectedReferenceError extends DomainError {
  readonly code = "UNEXPECTED_REFERENCE";

  constructor(readonly kind: WagerTransactionKind) {
    super(`${kind} não aceita transação de referência`);
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly code = "INVALID_TRANSACTION_STATE";

  constructor(
    readonly transactionId: string,
    readonly currentStatus: WagerTransactionStatus,
    readonly attemptedStatus: WagerTransactionStatus,
  ) {
    super(
      `Transação ${transactionId} já está ${currentStatus} (terminal) e não pode ir para ${attemptedStatus}`,
    );
  }
}

export class LedgerDirectionUnavailableError extends DomainError {
  readonly code = "LEDGER_DIRECTION_UNAVAILABLE";

  constructor(
    readonly kind: WagerTransactionKind,
    reason: string,
  ) {
    super(`Não há direção de ledger para ${kind}: ${reason}`);
  }
}
