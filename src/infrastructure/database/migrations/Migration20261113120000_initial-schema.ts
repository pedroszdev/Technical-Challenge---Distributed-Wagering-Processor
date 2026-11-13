import { Migration } from "@mikro-orm/migrations";

export class Migration20261113120000_initialSchema extends Migration {
  override name = "Migration20261113120000_initial-schema";

  override up(): void {
    // ------------------------------------------------------------------ wallets
    this.addSql(`
      CREATE TABLE wallets (
        id              uuid           PRIMARY KEY,
        player_id       uuid           NOT NULL,
        currency        char(3)        NOT NULL,
        balance_amount  numeric(20,2)  NOT NULL,
        version         integer        NOT NULL,
        created_at      timestamptz    NOT NULL,
        updated_at      timestamptz    NOT NULL,

        -- No máximo uma wallet por player + moeda.
        CONSTRAINT wallets_player_currency_uq UNIQUE (player_id, currency),

        -- Saldo nunca negativo: última barreira contra race condition / bug.
        CONSTRAINT wallets_balance_non_negative_ck CHECK (balance_amount >= 0),
        CONSTRAINT wallets_version_positive_ck CHECK (version >= 1),
        CONSTRAINT wallets_currency_format_ck CHECK (currency ~ '^[A-Z]{3}$'),

        -- Alvo das FKs compostas: permite que outras tabelas exijam que o
        -- player/moeda delas sejam OS MESMOS da wallet.
        CONSTRAINT wallets_id_player_currency_uq UNIQUE (id, player_id, currency),
        CONSTRAINT wallets_id_currency_uq UNIQUE (id, currency)
      )
    `);

    // ------------------------------------------------------------------ wager_transactions
    this.addSql(`
      CREATE TABLE wager_transactions (
        id                                  uuid           PRIMARY KEY,
        provider_id                         text           NOT NULL,
        external_transaction_id             text           NOT NULL,
        idempotency_key                     text           NOT NULL,
        payload_hash                        text           NOT NULL,
        wallet_id                           uuid           NOT NULL,
        player_id                           uuid           NOT NULL,
        round_id                            text           NOT NULL,
        game_id                             text           NOT NULL,
        kind                                text           NOT NULL,
        amount                              numeric(20,2)  NOT NULL,
        currency                            char(3)        NOT NULL,
        reference_external_transaction_id   text,
        reference_transaction_id            uuid,
        status                              text           NOT NULL,
        failure_code                        text,
        -- Saldo observado quando a transação terminou: devolvido em replays (regra 7).
        balance_after_amount                numeric(20,2),
        -- Controle do worker de PENDING_REFERENCE (seção 7.1).
        attempts                            integer        NOT NULL DEFAULT 0,
        next_attempt_at                     timestamptz,
        created_at                          timestamptz    NOT NULL,
        processed_at                        timestamptz,

        -- ---- idempotência
        -- Por provider: dois provedores podem escolher a mesma key sem colidir.
        CONSTRAINT wager_tx_provider_idempotency_key_uq UNIQUE (provider_id, idempotency_key),
        -- Busca por id externo e resolução de referências.
        CONSTRAINT wager_tx_provider_external_id_uq UNIQUE (provider_id, external_transaction_id),

        -- ---- valores válidos
        CONSTRAINT wager_tx_kind_ck
          CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        CONSTRAINT wager_tx_status_ck
          CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        CONSTRAINT wager_tx_amount_non_negative_ck CHECK (amount >= 0),
        -- Zero só para LOSS (mesma regra do domínio).
        CONSTRAINT wager_tx_amount_positive_unless_loss_ck CHECK (kind = 'LOSS' OR amount > 0),
        CONSTRAINT wager_tx_balance_after_non_negative_ck
          CHECK (balance_after_amount IS NULL OR balance_after_amount >= 0),
        CONSTRAINT wager_tx_attempts_non_negative_ck CHECK (attempts >= 0),

        -- ---- coerência entre colunas
        CONSTRAINT wager_tx_reversal_requires_reference_ck
          CHECK (kind NOT IN ('REFUND', 'ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
        CONSTRAINT wager_tx_bet_has_no_reference_ck
          CHECK (kind <> 'BET' OR reference_external_transaction_id IS NULL),
        CONSTRAINT wager_tx_processed_reversal_resolved_ck
          CHECK (kind NOT IN ('REFUND', 'ROLLBACK') OR status <> 'PROCESSED' OR reference_transaction_id IS NOT NULL),
        CONSTRAINT wager_tx_processed_has_timestamp_ck
          CHECK (status <> 'PROCESSED' OR processed_at IS NOT NULL),
        CONSTRAINT wager_tx_processed_has_balance_ck
          CHECK (status <> 'PROCESSED' OR balance_after_amount IS NOT NULL),
        -- failure_code preenchido SE E SOMENTE SE o status é REJECTED/FAILED.
        CONSTRAINT wager_tx_failure_code_iff_failed_ck
          CHECK ((status IN ('REJECTED', 'FAILED')) = (failure_code IS NOT NULL)),

        -- ---- relacionamentos
        -- FK composta: a transação só pode apontar para uma wallet que seja
        -- DO MESMO player e DA MESMA moeda.
        CONSTRAINT wager_tx_wallet_fk FOREIGN KEY (wallet_id, player_id, currency)
          REFERENCES wallets (id, player_id, currency),
        CONSTRAINT wager_tx_reference_fk FOREIGN KEY (reference_transaction_id)
          REFERENCES wager_transactions (id),
        -- Alvo da FK composta do ledger.
        CONSTRAINT wager_tx_id_wallet_uq UNIQUE (id, wallet_id)
      )
    `);

    // uma referência não pode ser revertida duas vezes pelo MESMO tipo
    // de operação. Só conta o que foi PROCESSED (um REFUND rejeitado não bloqueia)
    this.addSql(`
      CREATE UNIQUE INDEX wager_tx_single_reversal_per_kind_uq
        ON wager_transactions (reference_transaction_id, kind)
        WHERE status = 'PROCESSED' AND kind IN ('REFUND', 'ROLLBACK')
    `);

    // Worker de PENDING_REFERENCE: "quais estão vencidas para nova tentativa?"
    this.addSql(`
      CREATE INDEX wager_tx_pending_reference_due_idx
        ON wager_transactions (next_attempt_at)
        WHERE status = 'PENDING_REFERENCE'
    `);

    // Quando uma BET chega, achar as transações que estavam esperando por ela.
    this.addSql(`
      CREATE INDEX wager_tx_waiting_for_reference_idx
        ON wager_transactions (provider_id, reference_external_transaction_id)
        WHERE status = 'PENDING_REFERENCE'
    `);

    this.addSql(`CREATE INDEX wager_tx_wallet_idx ON wager_transactions (wallet_id)`);

    // ------------------------------------------------------------------ wallet_ledger_entries
    this.addSql(`
      CREATE TABLE wallet_ledger_entries (
        id                     uuid           PRIMARY KEY,
        wallet_id              uuid           NOT NULL,
        transaction_id         uuid           NOT NULL,
        direction              text           NOT NULL,
        amount                 numeric(20,2)  NOT NULL,
        currency               char(3)        NOT NULL,
        balance_before_amount  numeric(20,2)  NOT NULL,
        balance_after_amount   numeric(20,2)  NOT NULL,
        created_at             timestamptz    NOT NULL,

        -- No máximo um lançamento por transação por wallet 
        CONSTRAINT ledger_transaction_wallet_uq UNIQUE (transaction_id, wallet_id),

        CONSTRAINT ledger_direction_ck CHECK (direction IN ('DEBIT', 'CREDIT')),
        CONSTRAINT ledger_amount_positive_ck CHECK (amount > 0),
        CONSTRAINT ledger_balance_before_non_negative_ck CHECK (balance_before_amount >= 0),
        CONSTRAINT ledger_balance_after_non_negative_ck CHECK (balance_after_amount >= 0),

        -- O mesmo isBalanced() do domínio, garantido pelo banco.
        CONSTRAINT ledger_balanced_ck CHECK (
          (direction = 'DEBIT'  AND balance_after_amount = balance_before_amount - amount) OR
          (direction = 'CREDIT' AND balance_after_amount = balance_before_amount + amount)
        ),

        -- O lançamento tem a moeda da wallet...
        CONSTRAINT ledger_wallet_fk FOREIGN KEY (wallet_id, currency)
          REFERENCES wallets (id, currency),
        -- ...e pertence a uma transação DA MESMA wallet.
        CONSTRAINT ledger_transaction_fk FOREIGN KEY (transaction_id, wallet_id)
          REFERENCES wager_transactions (id, wallet_id)
      )
    `);

    // Paginação do extrato: "lançamentos da wallet X depois do cursor Y".
    // O id é UUID v7 (ordenado pelo tempo), então serve de cursor estável.
    this.addSql(`CREATE INDEX ledger_wallet_cursor_idx ON wallet_ledger_entries (wallet_id, id)`);

    this.addSql(`
      CREATE FUNCTION wallet_ledger_entries_immutable() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries é imutável: % não é permitido', TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_no_update_delete
        BEFORE UPDATE OR DELETE ON wallet_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION wallet_ledger_entries_immutable()
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_entries_no_truncate
        BEFORE TRUNCATE ON wallet_ledger_entries
        FOR EACH STATEMENT EXECUTE FUNCTION wallet_ledger_entries_immutable()
    `);

    // ------------------------------------------------------------------ inbox_messages
    this.addSql(`
      CREATE TABLE inbox_messages (
        consumer_name  text         NOT NULL,
        message_id     text         NOT NULL,
        payload_hash   text         NOT NULL,
        received_at    timestamptz  NOT NULL,
        processed_at   timestamptz,

        -- A deduplicação da fila: a 2ª entrega da mesma mensagem bate na PK.
        CONSTRAINT inbox_messages_pk PRIMARY KEY (consumer_name, message_id)
      )
    `);

    // ------------------------------------------------------------------ outbox_messages
    this.addSql(`
      CREATE TABLE outbox_messages (
        id               uuid         PRIMARY KEY,  -- vira o eventId do evento
        aggregate_id     uuid         NOT NULL,
        event_type       text         NOT NULL,
        payload          jsonb        NOT NULL,
        occurred_at      timestamptz  NOT NULL,
        attempts         integer      NOT NULL DEFAULT 0,
        next_attempt_at  timestamptz  NOT NULL,
        published_at     timestamptz,
        last_error       text,

        CONSTRAINT outbox_attempts_non_negative_ck CHECK (attempts >= 0)
      )
    `);

    // Publisher: "pendentes cujo next_attempt_at já passou". O índice parcial
    // fica pequeno mesmo com milhões de eventos já publicados.
    this.addSql(`
      CREATE INDEX outbox_pending_due_idx
        ON outbox_messages (next_attempt_at)
        WHERE published_at IS NULL
    `);
  }

  override down(): void {
    // Ordem inversa: quem tem FK sai antes de quem é referenciado.
    this.addSql(`DROP TABLE IF EXISTS outbox_messages`);
    this.addSql(`DROP TABLE IF EXISTS inbox_messages`);
    this.addSql(`DROP TABLE IF EXISTS wallet_ledger_entries`); // leva os triggers junto
    this.addSql(`DROP FUNCTION IF EXISTS wallet_ledger_entries_immutable()`);
    this.addSql(`DROP TABLE IF EXISTS wager_transactions`);
    this.addSql(`DROP TABLE IF EXISTS wallets`);
  }
}
