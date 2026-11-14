import type { MoneyProps } from "../money/money.ts";
import { IntegrationEvent, type EventContext } from "../shared/integration-events.ts";
import type { FailureCode } from "./failure-code.ts";
import type { WagerTransactionKind } from "./wager-transaction.enums.ts";
import type { WagerTransaction } from "./wager-transaction.ts";

export interface WagerTransactionRef {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
}

export interface WagerTransactionProcessedData extends WagerTransactionRef {
  balanceAfter: MoneyProps;
  referenceTransactionId?: string;
}

export interface WagerTransactionRejectedData extends WagerTransactionRef {
  failureCode: FailureCode;
}

export interface WagerTransactionPendingReferenceData extends WagerTransactionRef {
    referenceExternalTransactionId: string;
}



export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext) {
    return new WagerTransactionProcessed({
        eventId: Bun.randomUUIDv7(),         
        aggregateId: transaction.id,          
        correlationId: ctx.correlationId,     
        causationId: ctx.causationId, 
        occurredAt: transaction.processedAt!,
        data: {
            transactionId: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            walletId: transaction.walletId,
            playerId: transaction.playerId,
            roundId: transaction.roundId,
            gameId: transaction.gameId,
            kind: transaction.kind,
            money: transaction.money.toJSON(),
            balanceAfter: transaction.balanceAfter!.toJSON(),
            referenceTransactionId: transaction.referenceTransactionId
        },
    });
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext) {
    return new WagerTransactionRejected({
        eventId: Bun.randomUUIDv7(),         
        aggregateId: transaction.id,          
        correlationId: ctx.correlationId,     
        causationId: ctx.causationId, 
        occurredAt: new Date(),
        data: {
            transactionId: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            walletId: transaction.walletId,
            playerId: transaction.playerId,
            roundId: transaction.roundId,
            gameId: transaction.gameId,
            kind: transaction.kind,
            money: transaction.money.toJSON(),
            failureCode: transaction.failureCode!,
        },
    });
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext) {
    return new WagerTransactionPendingReference({
        eventId: Bun.randomUUIDv7(),         
        aggregateId: transaction.id,          
        correlationId: ctx.correlationId,     
        causationId: ctx.causationId, 
        occurredAt: new Date(),
        data: {
            transactionId: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            walletId: transaction.walletId,
            playerId: transaction.playerId,
            roundId: transaction.roundId,
            gameId: transaction.gameId,
            kind: transaction.kind,
            money: transaction.money.toJSON(),
            referenceExternalTransactionId: transaction.referenceExternalTransactionId!,
        },
    });
  }
}