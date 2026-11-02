import { z } from 'zod'
import {
  expenseInputSchema,
  purchaseDraftInputSchema,
  receivePurchaseSchema,
  supplierInputSchema,
  supplierPaymentSchema
} from '../../src/shared/procurement'
import { isBusinessDate } from '../../src/shared/business-date'
import { ProcurementRepository } from './procurement-repository'
import type { IpcHandlerRegistry } from './handler-registry'

const uuidSchema = z.object({ id: z.string().uuid() })
const supplierUpdateSchema = z.object({ id: z.string().uuid(), input: supplierInputSchema })
const draftUpdateSchema = z.object({ id: z.string().uuid(), input: purchaseDraftInputSchema })
const expenseUpdateSchema = z.object({ id: z.string().uuid(), input: expenseInputSchema })
const listSchema = z.object({ search: z.string().max(200).default('') })
const supplierListSchema = z.object({
  search: z.string().max(200).default(''),
  includeArchived: z.boolean().default(false)
})
const expenseListSchema = z.object({
  search: z.string().max(200).default(''),
  fromDate: z.string().refine(isBusinessDate, 'Enter a valid start date').optional(),
  toDate: z.string().refine(isBusinessDate, 'Enter a valid end date').optional(),
  includeArchived: z.boolean().default(false)
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

export function registerProcurementIpc(
  repository: ProcurementRepository,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  register('suppliers:list', trustedContents, registry, supplierListSchema, ({ search, includeArchived }) =>
    repository.listSuppliers(search, includeArchived))
  register('suppliers:create', trustedContents, registry, supplierInputSchema, (input) =>
    repository.createSupplier(input))
  register('suppliers:update', trustedContents, registry, supplierUpdateSchema, ({ id, input }) =>
    repository.updateSupplier(id, input))
  register('suppliers:archive', trustedContents, registry, uuidSchema, ({ id }) =>
    repository.archiveSupplier(id))
  register('suppliers:restore', trustedContents, registry, uuidSchema, ({ id }) =>
    repository.restoreSupplier(id))
  register('purchases:list', trustedContents, registry, listSchema, ({ search }) =>
    repository.listPurchases(search))
  register('purchases:get', trustedContents, registry, uuidSchema, ({ id }) =>
    repository.getPurchase(id) ?? null)
  register('purchases:create-draft', trustedContents, registry, purchaseDraftInputSchema, (input) =>
    repository.createPurchaseDraft(input))
  register('purchases:update-draft', trustedContents, registry, draftUpdateSchema, ({ id, input }) =>
    repository.updatePurchaseDraft(id, input))
  register('purchases:cancel-draft', trustedContents, registry, uuidSchema, ({ id }) =>
    repository.cancelPurchaseDraft(id))
  register('purchases:reopen-cancelled', trustedContents, registry, uuidSchema, ({ id }) =>
    repository.reopenCancelledPurchase(id))
  register('purchases:receive', trustedContents, registry, receivePurchaseSchema, (input) =>
    repository.receivePurchase(input))
  register('purchases:record-payment', trustedContents, registry, supplierPaymentSchema, (input) =>
    repository.recordSupplierPayment(input))
  register('expenses:categories', trustedContents, registry, z.object({}), () =>
    repository.listExpenseCategories())
  register('expenses:list', trustedContents, registry, expenseListSchema, ({ search, fromDate, toDate, includeArchived }) =>
    repository.listExpenses(search, fromDate, toDate, includeArchived))
  register('expenses:create', trustedContents, registry, expenseInputSchema, (input) =>
    repository.createExpense(input))
  register('expenses:update', trustedContents, registry, expenseUpdateSchema, ({ id, input }) =>
    repository.updateExpense(id, input))
  register('expenses:archive', trustedContents, registry, uuidSchema, ({ id }) =>
    repository.archiveExpense(id))
  register('expenses:restore', trustedContents, registry, uuidSchema, ({ id }) =>
    repository.restoreExpense(id))
}

export function removeProcurementIpc(registry: IpcHandlerRegistry): void {
  for (const channel of [
    'suppliers:list',
    'suppliers:create',
    'suppliers:update',
    'suppliers:archive',
    'suppliers:restore',
    'purchases:list',
    'purchases:get',
    'purchases:create-draft',
    'purchases:update-draft',
    'purchases:cancel-draft',
    'purchases:reopen-cancelled',
    'purchases:receive',
    'purchases:record-payment',
    'expenses:categories',
    'expenses:list',
    'expenses:create',
    'expenses:update',
    'expenses:archive',
    'expenses:restore'
  ]) {
    registry.removeHandler(channel)
  }
}
