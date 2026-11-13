import { DomainError } from "../shared/domain-error.ts";

// Valor ou moeda em formato inválido (ex.: "abc", "1e5", "10.123", "-5.00", "brl")
export class InvalidMoneyError extends DomainError {
  readonly code = "INVALID_MONEY";

  constructor(reason: string) {
    super(`Valor monetário inválido: ${reason}`);
  }
}

// Operação entre moedas diferentes (ex.: BRL + USD)
export class CurrencyMismatchError extends DomainError {
  readonly code = "CURRENCY_MISMATCH";

  constructor(
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Moedas diferentes: esperado ${expected}, recebido ${received}`);
  }
}
