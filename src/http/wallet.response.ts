import type { MoneyProps } from "../domain/money/money.ts";
import type { Wallet } from "../domain/wallet/wallet.ts";

/** Formato de resposta da seção 9 do README (igual no POST e no GET). */
export interface WalletResponse {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export function toWalletResponse(wallet: Wallet): WalletResponse {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}
