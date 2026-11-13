// Em arquivo próprio para evitar importação circular entre ledger-entry.ts e
// ledger-entry.errors.ts (e porque a WagerTransaction também vai usar).
export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}
