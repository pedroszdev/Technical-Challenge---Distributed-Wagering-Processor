import Decimal from "decimal.js";
import { CurrencyMismatchError, InvalidMoneyError } from "./money.errors.ts";

const MoneyDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

const SCALE = 2;

// A regex sozinha já recusa: "", "abc", "NaN", "Infinity", "1e5", "-5.00", "+5", " 5", "5.", ".5", "10.123" e "1,50".
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/;

// ISO-4217: três letras maiúsculas (BRL, USD, EUR).
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (typeof props.amount !== "string") {
      throw new InvalidMoneyError("amount deve ser uma string decimal");
    }
    if (!AMOUNT_PATTERN.test(props.amount)) {
      throw new InvalidMoneyError(`amount "${props.amount}" fora do formato esperado`);
    }
    Money.assertValidCurrency(props.currency);

    return new Money(new MoneyDecimal(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    Money.assertValidCurrency(currency);
    return new Money(new MoneyDecimal(0), currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }


  toJSON(): MoneyProps {
    return { amount: this.formatAmount(), currency: this.currency };
  }

  toString(): string {
    return `${this.formatAmount()} ${this.currency}`;
  }


// Sempre 2 casas
  private formatAmount(): string {
    const fixed = this.value.toFixed(SCALE);
    return fixed === "-0.00" ? "0.00" : fixed;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private static assertValidCurrency(currency: unknown): asserts currency is string {
    if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(`currency "${String(currency)}" não é ISO-4217`);
    }
  }
}
