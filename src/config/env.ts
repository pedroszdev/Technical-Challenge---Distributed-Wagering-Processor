/**
 * Lê e valida as variáveis de ambiente uma única vez.
 * Se faltar algo obrigatório, a aplicação nem sobe (falha rápida).
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const env = {
  port: Number(optional("PORT", "3000")),
  databaseUrl: required("DATABASE_URL"),
  aws: {
    region: optional("AWS_REGION", "us-east-1"),
    sqsEndpoint: optional("SQS_ENDPOINT", "http://localhost:4566"),
    queueName: optional("SQS_QUEUE_NAME", "wager-transactions.fifo"),
    dlqName: optional("SQS_DLQ_NAME", "wager-transactions-dlq.fifo"),
  },
} as const;
