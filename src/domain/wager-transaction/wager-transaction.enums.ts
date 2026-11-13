export enum WagerTransactionKind {
  Opening = "OPENING", // interno: crédito de abertura da wallet
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING", // aceita, ainda não aplicada
  PendingReference = "PENDING_REFERENCE", // aguardando a transação referenciada
  Processed = "PROCESSED", // aplicada (terminal)
  Rejected = "REJECTED", // violação de regra de negócio (terminal)
  Failed = "FAILED", // erro permanente de infraestrutura (terminal, auditável)
}
