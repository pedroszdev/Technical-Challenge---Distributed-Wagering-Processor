# Distributed Wagering Processor

Serviço financeiro que processa transações de apostas (BET, WIN, LOSS, REFUND, ROLLBACK)
vindas de provedores de jogos, via HTTP e SQS.

## Stack

Bun 1.x · TypeScript (strict) · NestJS 12 · MikroORM 7 · PostgreSQL 17 · SQS (MiniStack) · Docker Compose

> **Por que MiniStack e não LocalStack?** Desde março de 2026 a imagem do LocalStack exige
> conta e auth token. O MiniStack expõe a mesma API do SQS na porta 4566, sem cadastro.

## Pré-requisitos

- Bun 1.x
- Docker + Docker Compose

## Setup

```bash
bun install
cp .env.example .env
bun run infra:up        # sobe Postgres + SQS e cria as filas FIFO
bun run migration:up    # aplica as migrations
bun run dev             # API em http://localhost:3000
```

## Comandos

| Comando | O que faz |
|---|---|
| `bun run dev` | Sobe a API com reload automático |
| `bun run typecheck` | Checagem de tipos (sem gerar build) |
| `bun test` | Roda os testes |
| `bun run infra:up` / `infra:down` | Sobe/derruba a infraestrutura |
| `bun run infra:reset` | Derruba e **apaga os dados** (volumes) |
| `bun run migration:create` | Cria uma migration vazia |
| `bun run migration:up` / `migration:down` | Aplica/reverte migrations |
| `docker compose --profile app up --build --scale app=3` | Sobe 3 instâncias da aplicação |

## Infraestrutura local

| Serviço | Endereço |
|---|---|
| PostgreSQL | `localhost:5432` (bancos `wagering` e `wagering_test`, usuário/senha `wagering`) |
| SQS | `http://localhost:4566` — filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo` |

Decisões técnicas e trade-offs: ver [ARCHITECTURE.md](./ARCHITECTURE.md).
