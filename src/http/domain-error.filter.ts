import { Catch, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { DomainError } from "../domain/shared/domain-error.ts";

/**
 * Traduz o `code` do erro de domínio para o status HTTP.
 *
 * O provedor decide se reenvia olhando o STATUS (e o `code`), sem precisar ler a
 * mensagem de texto (seção 9 do README). No dia 2 esta tabela cresce:
 * conflito de idempotência (409), rejeição de negócio (422), pendente (202),
 * falha transitória (503).
 */
const STATUS_BY_CODE: Record<string, HttpStatus> = {
  // payload inválido: corrija antes de reenviar
  INVALID_PAYLOAD: HttpStatus.BAD_REQUEST,
  INVALID_MONEY: HttpStatus.BAD_REQUEST,
  INVALID_AMOUNT: HttpStatus.BAD_REQUEST,
  CURRENCY_MISMATCH: HttpStatus.BAD_REQUEST,
  MISSING_REFERENCE: HttpStatus.BAD_REQUEST,
  UNEXPECTED_REFERENCE: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT, 
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  CONCURRENT_UPDATE: HttpStatus.SERVICE_UNAVAILABLE,
  WALLET_PLAYER_MISMATCH: HttpStatus.BAD_REQUEST
};

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = STATUS_BY_CODE[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    // Erro de domínio sem status mapeado = bug (ex.: INVALID_TRANSACTION_STATE).
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Erro de domínio não mapeado: ${error.code}`, error.stack);
    }

    response.status(status).json({ code: error.code, message: error.message });
  }
}
