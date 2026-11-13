import type { Money } from "../money/money.ts";
import { DomainError } from "../shared/domain-error.ts";
import { LedgerDirection } from "./ledger-direction.ts";

export class UnbalancedLedgerEntryError extends DomainError {
  readonly code = "LEDGER_ENTRY_UNBALANCED";

  constructor(
    readonly direction: LedgerDirection,
    readonly before: Money,
    readonly money: Money,
    readonly after: Money 
  ) {
    const operation = direction === LedgerDirection.Debit ? '-' : '+'
    super(`Para usar o ${direction}: ${before} ${operation} ${money} precisa ser igual a ${after}`)
  }
}