import { UniqueConstraintViolationException } from "@mikro-orm/postgresql";

/**
 * Diz se o erro é a violação de UMA constraint específica.
 *
 * O driver `pg` expõe o nome da constraint em `error.constraint`, mas o tipo do
 * MikroORM não declara esse campo, por isso a leitura defensiva.
 */
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof UniqueConstraintViolationException)) return false;
  const constraint = (error as { constraint?: unknown }).constraint;
  return constraint === constraintName;
}
