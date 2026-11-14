import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { DomainErrorFilter } from "./http/domain-error.filter.ts";
import ormConfig from "./infrastructure/database/mikro-orm.config.ts";
import { WalletsModule } from "./wallets.module.ts";
import { WageringModule } from "./wagering.module.ts";

@Module({
  imports: [MikroOrmModule.forRoot(ormConfig), WalletsModule, WageringModule],
  // Filter global: vale para todos os controllers.
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}
