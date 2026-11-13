import { LedgerDirection } from "../ledger/ledger-direction.ts";
import type { Money } from "../money/money.ts";
import { InvalidAmountError } from "../wallet/wallet.errors.ts";
import type { FailureCode } from "./failure-code.ts";
import { WagerTransactionKind, WagerTransactionStatus } from "./wager-transaction.enums.ts";
import {
  InvalidTransactionStateError,
  LedgerDirectionUnavailableError,
  MissingReferenceError,
  UnexpectedReferenceError,
} from "./wager-transaction.errors.ts";

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  /** id no provedor — não o id interno */
  referenceExternalTransactionId: string | undefined;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  /** id no provedor — não o id interno */
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    /** id no provedor — não o id interno */
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  /** Nasce em PENDING. Valida a exigência de referência por kind. */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const status = WagerTransactionStatus.Pending;
    const date = new Date();

    // String vazia ("") conta como "sem referência".
    const hasReference = !!props.referenceExternalTransactionId;

    if ((props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback) && !hasReference) {
      throw new MissingReferenceError(props.kind);
    }
    if (props.kind === WagerTransactionKind.Bet && props.referenceExternalTransactionId !== undefined) {
      throw new UnexpectedReferenceError(props.kind);
    }
    // Valor negativo nunca. Zero só para LOSS (perder não move dinheiro).
    if (props.money.isNegative()) {
      throw new InvalidAmountError("o valor não pode ser negativo");
    }
    if (props.money.isZero() && props.kind !== WagerTransactionKind.Loss) {
      throw new InvalidAmountError(`${props.kind} exige um valor positivo`);
    }

    return new WagerTransaction(props.id, props.providerId, props.externalTransactionId, props.idempotencyKey, props.payloadHash, props.walletId, props.playerId, props.roundId, props.gameId, props.kind, props.money, props.referenceExternalTransactionId, date, status);
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    const { id, providerId, externalTransactionId, idempotencyKey, payloadHash, walletId, playerId, roundId, gameId, kind, money, referenceExternalTransactionId, createdAt, status, referenceTransactionId, failureCode, processedAt } = state;
    return new WagerTransaction(id, providerId, externalTransactionId, idempotencyKey, payloadHash, walletId, playerId, roundId, gameId, kind, money, referenceExternalTransactionId, createdAt, status, referenceTransactionId, failureCode, processedAt);
  }

  get status(): WagerTransactionStatus { return this._status; }
  get referenceTransactionId(): string | undefined { return this._referenceTransactionId; }
  get failureCode(): FailureCode | undefined { return this._failureCode; }
  get processedAt(): Date | undefined { return this._processedAt; }

  // ---- transições (lançam InvalidTransactionStateError se o estado atual for terminal)
  // Regra: primeiro TODAS as validações, depois as mudanças.

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal(WagerTransactionStatus.Processed);
    if (this.requiresReference() && !referenceTransactionId) {
      throw new MissingReferenceError(this.kind);
    }

    this._status = WagerTransactionStatus.Processed;
    this._processedAt = at;
    this._referenceTransactionId = referenceTransactionId;
  }

  markPendingReference(): void {
    this.assertNotTerminal(WagerTransactionStatus.PendingReference);
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal(WagerTransactionStatus.Rejected);
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal(WagerTransactionStatus.Failed);
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  // ---- consultas de domínio

  isTerminal(): boolean {
    if (this._status === WagerTransactionStatus.Processed || this._status === WagerTransactionStatus.Rejected || this._status === WagerTransactionStatus.Failed) {
      return true;
    }
    return false;
  }

  affectsBalance(): boolean {
    if (this.kind === WagerTransactionKind.Loss) {
      return false;
    }
    return true;
  }

  requiresReference(): boolean {
    if (this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback) {
      return true;
    }
    return false;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Loss:
        throw new LedgerDirectionUnavailableError(this.kind, "LOSS não move saldo");

      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new LedgerDirectionUnavailableError(this.kind, "ROLLBACK precisa da transação referenciada");
        }
        const original = reference.ledgerDirectionFor();
        return original === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
      }
    }
  }

  private assertNotTerminal(attempted: WagerTransactionStatus): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this.id, this._status, attempted);
    }
  }
}
