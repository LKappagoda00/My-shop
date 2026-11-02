import { z } from 'zod'
import { saleInputSchema, saleVoidSchema } from '../../src/shared/sales'
import { SalesRepository } from './sales-repository'
import type { IpcHandlerRegistry } from './handler-registry'

const uuidSchema = z.object({ id: z.string().uuid() })
const listSchema = z.object({
  search: z.string().max(200).default(''),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

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

export function registerSalesIpc(
  repository: SalesRepository,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  register('sales:create', trustedContents, registry, saleInputSchema, (input) => repository.createSale(input))
  register('sales:list', trustedContents, registry, listSchema, ({ search, businessDate }) =>
    repository.listSales(search, businessDate))
  register('sales:get', trustedContents, registry, uuidSchema, ({ id }) => repository.getSale(id) ?? null)
  register('sales:void', trustedContents, registry, saleVoidSchema, (input) => repository.voidSale(input))
}

export function removeSalesIpc(registry: IpcHandlerRegistry): void {
  registry.removeHandler('sales:create')
  registry.removeHandler('sales:list')
  registry.removeHandler('sales:get')
  registry.removeHandler('sales:void')
}
