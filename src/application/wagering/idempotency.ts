import type { WagerTransaction } from "../../domain/wager-transaction/wager-transaction";

export type IdempotencyDecision =
  | { type: "new" }
  | { type: "replay"; transaction: WagerTransaction }
  | { type: "conflict"; transaction: WagerTransaction };

export function decideIdempotency(
  existing: WagerTransaction | null,
  payloadHash: string,
): IdempotencyDecision {
    if (!existing) {
        return { type: "new" }
    }
    if (!existing.matchesPayload(payloadHash)) {
        return { type: "conflict", transaction: existing }
    }
    return { type: "replay", transaction: existing }
}
