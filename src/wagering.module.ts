import { Module } from "@nestjs/common";
import { DatabaseModule } from "./infrastructure/database/database.module.ts";
import { ProcessWagerTransactionUseCase } from "./application/wagering/process-wager-transaction.use-case.ts";

@Module({
  imports: [DatabaseModule],
  providers: [ProcessWagerTransactionUseCase],
  exports: [ProcessWagerTransactionUseCase],  
})
export class WageringModule {}
