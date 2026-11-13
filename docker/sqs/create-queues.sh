#!/bin/sh
# Cria a DLQ e a fila principal (FIFO). Idempotente: rodar de novo não quebra nada.
set -eu

aws_sqs() {
  aws --endpoint-url "$SQS_ENDPOINT" sqs "$@"
}

echo "Aguardando o SQS em $SQS_ENDPOINT..."
i=0
until aws_sqs list-queues >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "SQS não respondeu a tempo" >&2
    exit 1
  fi
  sleep 1
done

DLQ_URL=$(aws_sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true \
  --query QueueUrl --output text)

DLQ_ARN=$(aws_sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)

# maxReceiveCount: depois de 5 entregas sem ack, a mensagem vai para a DLQ.
# Esse número é uma decisão sua; documente no ARCHITECTURE.md.
cat > /tmp/main-queue-attributes.json <<EOF
{
  "FifoQueue": "true",
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}"
}
EOF

aws_sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes file:///tmp/main-queue-attributes.json \
  --query QueueUrl --output text

echo "Filas criadas:"
aws_sqs list-queues
