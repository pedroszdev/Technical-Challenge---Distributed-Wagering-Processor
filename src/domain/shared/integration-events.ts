/** O que todo evento recebe ao ser criado. */
export interface IntegrationEventProps<TData> {
  eventId: string;        // id único do evento (vira o id da linha da outbox)
  aggregateId: string;    // de quem é o evento (a transação ou a wallet)
  correlationId: string;  // liga todos os eventos que nasceram do mesmo pedido
  causationId?: string;   // o que causou o evento (ex.: o messageId do SQS)
  occurredAt: Date;
  data: TData;
}

/** Contexto que vem de quem chamou o use case (HTTP ou SQS). */
export interface EventContext {
  correlationId: string;
  causationId?: string;
}

/** Formato JSON do evento — o que vai para a outbox e depois para o SQS. */
export interface IntegrationEventJSON<TData> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string; // ISO-8601
  version: number;
  data: TData;
}

export abstract class IntegrationEvent<TData> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: TData;


    protected constructor(props: IntegrationEventProps<TData>) {
        this.eventId = props.eventId;
        this.aggregateId = props.aggregateId;
        this.correlationId = props.correlationId;
        this.causationId = props.causationId;
        this.occurredAt = props.occurredAt;
        this.data =  props.data;
    }

  toJSON(): IntegrationEventJSON<TData> {
    return {
        eventId: this.eventId,
        eventType: this.eventType,
        aggregateId: this.aggregateId,
        correlationId: this.correlationId,
        ...(this.causationId ? { causationId: this.causationId } : {}),
        occurredAt: this.occurredAt.toISOString(),
        version: this.version, 
        data: this.data
    }
  }
}
