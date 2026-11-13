import { defineEntity, p, type InferEntity } from "@mikro-orm/postgresql";

/**
 * Formato de uma linha da tabela `wallets`. NÃO é a classe de domínio:
 * a tradução Wallet <-> WalletRecord fica no wallet.mapper.ts.
 *
 * O MikroORM converte camelCase -> snake_case (balanceAmount -> balance_amount).
 * O schema real (constraints, índices) vem da migration, não daqui.
 */
export const WalletEntity = defineEntity({
  name: "WalletEntity",
  tableName: "wallets",
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid(),
    currency: p.string().columnType("char(3)"),
    // decimal volta como STRING ("1000.00"): nunca passa por number.
    balanceAmount: p.decimal().columnType("numeric(20,2)"),
    version: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export type WalletRecord = InferEntity<typeof WalletEntity>;
