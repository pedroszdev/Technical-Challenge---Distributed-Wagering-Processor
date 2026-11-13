import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.ts";
import { env } from "./config/env.ts";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Faz o Nest chamar onModuleDestroy/onApplicationShutdown ao receber SIGTERM.
  // Você vai precisar disso para o consumidor SQS terminar as mensagens em andamento.
  app.enableShutdownHooks();

  await app.listen(env.port);
}

await bootstrap();
