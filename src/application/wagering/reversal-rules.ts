import { FailureCode } from "../../domain/wager-transaction/failure-code.ts";
import type { WagerTransaction } from "../../domain/wager-transaction/wager-transaction.ts";
import { WagerTransactionKind, WagerTransactionStatus } from "../../domain/wager-transaction/wager-transaction.enums.ts";

export function checkReversal(
  reversal: WagerTransaction,        // o REFUND ou ROLLBACK que chegou
  reference: WagerTransaction,       // a transação que ele quer reverter
  alreadyReversed: boolean,          // o resultado do hasProcessedReversal()
): FailureCode | undefined {          // undefined = "pode reverter" 
    if (reversal.playerId !== reference.playerId ||
        reversal.walletId !== reference.walletId ||
        reversal.money.currency !== reference.money.currency ||
        reversal.roundId !== reference.roundId
    ) {
        return FailureCode.ReferenceMismatch
    }

    if (reversal.kind === WagerTransactionKind.Refund && reference.kind !== WagerTransactionKind.Bet ) {
        return FailureCode.InvalidReferenceKind
    }
    
    if (reversal.kind === WagerTransactionKind.Rollback && (reference.kind !== WagerTransactionKind.Bet && reference.kind !== WagerTransactionKind.Win && reference.kind !== WagerTransactionKind.Refund) ) {
        return FailureCode.InvalidReferenceKind
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
        return FailureCode.ReferenceNotProcessed
    }

    if (!reversal.money.equals(reference.money)) {
        return FailureCode.AmountMismatch
    }

    if (alreadyReversed) {
        return FailureCode.AlreadyReversed;
    }

    return undefined;
}