import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { InvalidPayloadError } from "../application/shared/invalid-payload.error.ts";
import { CreateWalletUseCase } from "../application/wallet/create-wallet.use-case.ts";
import { GetWalletUseCase } from "../application/wallet/get-wallet.use-case.ts";
import { parseCreateWalletRequest } from "./create-wallet.request.ts";
import { toWalletResponse, type WalletResponse } from "./wallet.response.ts";

/** Pipe do Nest para o :walletId, lançando o NOSSO erro (mesmo formato de resposta). */
const walletIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new InvalidPayloadError("walletId deve ser um UUID"),
});

/**
 * Controller "magro": só traduz HTTP <-> use case. Nenhuma regra de negócio aqui,
 * para que o consumidor SQS possa reaproveitar os mesmos use cases.
 */
@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<WalletResponse> {
    const input = parseCreateWalletRequest(body);
    const wallet = await this.createWallet.execute(input);
    return toWalletResponse(wallet);
  }

  @Get(":walletId")
  async get(@Param("walletId", walletIdPipe) walletId: string): Promise<WalletResponse> {
    const wallet = await this.getWallet.execute(walletId);
    return toWalletResponse(wallet);
  }
}
