import { DomainError } from "../../domain/shared/domain-error.ts";

/**
 * Payload com formato inválido (campo faltando, tipo errado, UUID malformado...).
 * Fica na camada de aplicação, e não no HTTP, porque o consumidor SQS (dia 2)
 * também valida mensagens e lança o mesmo erro.
 */
export class InvalidPayloadError extends DomainError {
  readonly code = "INVALID_PAYLOAD";

  constructor(reason: string) {
    super(`Payload inválido: ${reason}`);
  }
}
