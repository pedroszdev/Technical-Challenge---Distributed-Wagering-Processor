import { CurrencyMismatchError } from "../money/money.errors.ts";
import { Money } from "../money/money.ts";
import { InsufficientFundsError, InvalidAmountError } from "./wallet.errors.ts";

interface OpenProps {
    id: string;
    playerId: string;
    initialBalance: Money;
}
export interface WalletState {
    id: string,
    playerId: string,
    currency: string,
    balance: Money,
    version: number,
    createdAt: Date,
    updatedAt: Date,
}
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenProps): Wallet {
    const {id, playerId} = props;

    if (props.initialBalance.isNegative()) {
        throw new InvalidAmountError('saldo inicial não pode ser negativo')
    }

    const currency = props.initialBalance.currency;
    const version = 1;
    const balance = props.initialBalance;
    const updatedAt = new Date();
    const createdAt = new Date();

    return new Wallet(id, playerId, currency, balance, version, createdAt, updatedAt)
  }

  /** Reconstrução a partir da persistência — não revalida transições. */
  static rehydrate(state: WalletState): Wallet {
    const { id, playerId, currency, balance, version, createdAt, updatedAt } = state
    return new Wallet(id, playerId, currency, balance, version, createdAt, updatedAt)
  };

  get balance(): Money { return this._balance; }
  get version(): number { return this._version; }
  get updatedAt(): Date { return this._updatedAt; }

  // Aplicam a movimentação mantendo saldo e ledger consistentes entre si.
  // Assinatura e retorno são decisão sua.
  debit(money: Money): { before: Money; after: Money } {
    this.assertSameCurrency(money)

    if (!money.isPositive()) {
        throw new InvalidAmountError('money tem que ser um valor positivo')
    }
    if (this._balance.isLessThan(money)) {
        throw new InsufficientFundsError(this.id, this._balance, money)
    }
    const before = this._balance
    this._balance = this._balance.subtract(money)
    this._version += 1
    this._updatedAt = new Date()

    return  { before , after: this.balance  }

  }

  credit(money: Money): { before: Money; after: Money } {
    this.assertSameCurrency(money)

    if (!money.isPositive()) {
        throw new InvalidAmountError('money tem que ser um valor positivo')
    }

    const before = this._balance
    this._balance = this._balance.add(money)
    this._version += 1
    this._updatedAt = new Date()

    return  { before , after: this.balance  }

  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
       throw new CurrencyMismatchError(this.currency, other.currency)
    }
    
  }
}