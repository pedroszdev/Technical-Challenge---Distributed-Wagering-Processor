import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import ormConfig from "./infrastructure/database/mikro-orm.config.ts";

@Module({
  imports: [MikroOrmModule.forRoot(ormConfig)],
})
export class AppModule {}
