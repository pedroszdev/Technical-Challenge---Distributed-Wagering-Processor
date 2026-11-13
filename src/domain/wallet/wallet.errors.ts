import { DomainError } from "../shared/domain-error.ts";
import type { Money } from "../money/money.ts";

// Saldo menor que o valor do débito (ex.: saldo 20.00, aposta de 80.00).
export class InsufficientFundsError extends DomainError {
  readonly code = "INSUFFICIENT_FUNDS";

  constructor(
    readonly walletId: string,
    readonly balance: Money,
    readonly requested: Money,
  ) {
    super(`Saldo insuficiente na wallet ${walletId}: saldo ${balance}, solicitado ${requested}`);
  }
}

// Valor de movimentação inválido: zero ou negativo (ou saldo inicial negativo).
export class InvalidAmountError extends DomainError {
  readonly code = "INVALID_AMOUNT";

  constructor(reason: string) {
    super(`Valor inválido: ${reason}`);
  }
}
