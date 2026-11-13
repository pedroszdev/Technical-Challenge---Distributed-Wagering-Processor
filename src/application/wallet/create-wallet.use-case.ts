import { Injectable } from "@nestjs/common";
// Import NORMAL (não `import type`): o Nest usa o tipo em tempo de execução para injetar.
import { EntityManager } from "@mikro-orm/postgresql";
import { WalletLedgerEntry } from "../../domain/ledger/ledger-entry.ts";
import { Money } from "../../domain/money/money.ts";
import { WagerTransaction } from "../../domain/wager-transaction/wager-transaction.ts";
import { WagerTransactionKind } from "../../domain/wager-transaction/wager-transaction.enums.ts";
import { Wallet } from "../../domain/wallet/wallet.ts";
import { isUniqueViolation } from "../../infrastructure/database/constraint-violation.ts";
import { LedgerEntryRepository } from "../../infrastructure/database/repositories/ledger-entry.repository.ts";
import { WagerTransactionRepository } from "../../infrastructure/database/repositories/wager-transaction.repository.ts";
import { WalletRepository } from "../../infrastructure/database/repositories/wallet.repository.ts";
import { WalletAlreadyExistsError } from "./wallet.errors.ts";

export interface CreateWalletInput {
  playerId: string;
  initialBalance: Money;
}

/**
 * Valores fixos da transação interna OPENING: ela não vem de um provedor real.
 * O externalTransactionId/idempotencyKey usa o id da wallet, então é único por construção.
 */
const OPENING = {
  providerId: "internal",
  payloadHash: "opening",
  roundId: "opening",
  gameId: "internal",
} as const;

@Injectable()
export class CreateWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly wallets: WalletRepository,
    private readonly transactions: WagerTransactionRepository,
    private readonly ledger: LedgerEntryRepository,
  ) {}

  async execute(input: CreateWalletInput): Promise<Wallet> {
    try {
      // Tudo dentro da MESMA transação SQL: ou grava wallet + OPENING + ledger, ou nada.
      return await this.em.transactional(async (tx) => {
        const wallet = Wallet.open({
          id: Bun.randomUUIDv7(),
          playerId: input.playerId,
          initialBalance: input.initialBalance,
        });
        await this.wallets.insert(tx, wallet);

        // Saldo inicial zero: nada a registrar no ledger (seção 9).
        if (input.initialBalance.isPositive()) {
          await this.recordOpening(tx, wallet, input.initialBalance);
        }

        return wallet;
      });
    } catch (error) {
      // Quem detecta a duplicata é o BANCO (seguro com concorrência), não um SELECT antes.
      if (isUniqueViolation(error, "wallets_player_currency_uq")) {
        throw new WalletAlreadyExistsError(input.playerId, input.initialBalance.currency);
      }
      throw error;
    }
  }

  /** Transação OPENING (PROCESSED) + lançamento CREDIT de 0.00 até o saldo inicial. */
  private async recordOpening(tx: EntityManager, wallet: Wallet, initialBalance: Money): Promise<void> {
    const now = new Date();
    const openingKey = `opening:${wallet.id}`;

    const opening = WagerTransaction.create({
      ...OPENING,
      id: Bun.randomUUIDv7(),
      externalTransactionId: openingKey,
      idempotencyKey: openingKey,
      walletId: wallet.id,
      playerId: wallet.playerId,
      kind: WagerTransactionKind.Opening,
      money: initialBalance,
      referenceExternalTransactionId: undefined,
    });
    opening.markProcessed(undefined, now, wallet.balance);

    const entry = WalletLedgerEntry.create({
      id: Bun.randomUUIDv7(),
      walletId: wallet.id,
      transactionId: opening.id,
      direction: opening.ledgerDirectionFor(),
      money: initialBalance,
      balanceBefore: Money.zero(wallet.currency),
      balanceAfter: wallet.balance,
    });

    // Ordem importa por causa das FKs: wallet -> transação -> lançamento.
    await this.transactions.insert(tx, opening);
    await this.ledger.insert(tx, entry);
  }
}
