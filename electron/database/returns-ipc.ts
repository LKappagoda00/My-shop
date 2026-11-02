import { z } from 'zod'
import { salesReturnInputSchema } from '../../src/shared/returns'
import { ReturnsRepository } from './returns-repository'
import type { IpcHandlerRegistry } from './handler-registry'

const listSchema = z.object({ search: z.string().max(200).default('') })
const idSchema = z.object({ id: z.string().uuid() })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid request: ${detail}`)
  }
  return result.data
}

function register<TInput, TOutput>(
  channel: string,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry,
  schema: z.ZodType<TInput>,
  action: (input: TInput) => TOutput
): void {
  registry.handle(channel, (event, value) => {
    if (event.sender !== trustedContents()) throw new Error('Rejected request from an untrusted renderer')
    return action(parse(schema, value))
  })
}

export function registerReturnsIpc(
  repository: ReturnsRepository,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  register('returns:create', trustedContents, registry, salesReturnInputSchema, (input) =>
    repository.createReturn(input))
  register('returns:list', trustedContents, registry, listSchema, ({ search }) =>
    repository.listReturns(search))
  register('returns:get', trustedContents, registry, idSchema, ({ id }) =>
    repository.getReturn(id) ?? null)
}

export function removeReturnsIpc(registry: IpcHandlerRegistry): void {
  registry.removeHandler('returns:create')
  registry.removeHandler('returns:list')
  registry.removeHandler('returns:get')
}
