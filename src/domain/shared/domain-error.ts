/**
 * Base de todos os erros de regra de negócio.
 *
 * Cada erro tem um `code` estável (legível por máquina). Mais tarde a camada HTTP
 * e o consumidor SQS vão usar esse código para decidir o status/ack, sem precisar
 * interpretar a mensagem de texto.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
