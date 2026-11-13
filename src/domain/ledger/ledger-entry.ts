import type { Money } from "../money/money.ts";
import { CurrencyMismatchError } from "../money/money.errors.ts";
import { InvalidAmountError } from "../wallet/wallet.errors.ts";
import { LedgerDirection } from "./ledger-direction.ts";
import { UnbalancedLedgerEntryError } from "./ledger-entry.errors.ts";

export interface CreateLedgerEntryProps {
   id: string,
   walletId: string, 
   transactionId: string,
   direction: LedgerDirection,
   money: Money,
   balanceBefore: Money,
   balanceAfter: Money,
}

export interface LedgerEntryState {
   id: string,
   walletId: string, 
   transactionId: string,
   direction: LedgerDirection,
   money: Money,
   balanceBefore: Money,
   balanceAfter: Money,
   createdAt: Date
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!(props.money.currency === props.balanceBefore.currency)) {
        throw new CurrencyMismatchError(props.balanceBefore.currency, props.money.currency)
    }
    if (!(props.balanceBefore.currency === props.balanceAfter.currency)) {
        throw new CurrencyMismatchError(props.balanceBefore.currency, props.balanceAfter.currency)
    }
    if (!props.money.isPositive()) {
            throw new InvalidAmountError('money tem que ser um valor positivo')
        }
    if (props.balanceAfter.isNegative()) {
        throw new InvalidAmountError('Saldo final não pode ser negativo')
    }

    const date = new Date()
    const entry = new WalletLedgerEntry(props.id, props.walletId, props.transactionId, props.direction, props.money, props.balanceBefore, props.balanceAfter, date)
    
    if (!entry.isBalanced()) {
        throw new UnbalancedLedgerEntryError(props.direction, props.balanceBefore, props.money, props.balanceAfter)
    }

    return entry
}
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    const { id, walletId, transactionId, direction, money, balanceBefore, balanceAfter, createdAt } = state;
    return new WalletLedgerEntry(id, walletId, transactionId, direction, money, balanceBefore, balanceAfter, createdAt)
  }

  /** balanceBefore ± money === balanceAfter. Verificada na factory. */
  isBalanced(): boolean {
    const expected = this.direction === LedgerDirection.Debit ? this.balanceBefore.subtract(this.money) : this.balanceBefore.add(this.money)
    return expected.equals(this.balanceAfter)
}
}