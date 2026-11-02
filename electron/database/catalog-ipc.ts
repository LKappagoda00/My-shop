import { z } from 'zod'
import {
  categoryInputSchema,
  productInputSchema,
  productUpdateSchema,
  stockAdjustmentSchema,
  stockReconciliationSchema
} from '../../src/shared/catalog'
import { CatalogRepository } from './catalog-repository'
import { isUniqueConstraintError } from './primitives'
import type { IpcHandlerRegistry } from './handler-registry'

const uuidSchema = z.string().uuid()
const searchSchema = z.string().max(200).default('')
const includeArchivedSchema = z.boolean().default(false)
const productSearchSchema = z.object({
  search: searchSchema,
  includeArchived: includeArchivedSchema
})
const categoryListSchema = z.object({ includeArchived: includeArchivedSchema })
const productUpdateRequestSchema = z.object({
  id: uuidSchema,
  input: productUpdateSchema
})
const categoryUpdateRequestSchema = z.object({
  id: uuidSchema,
  input: categoryInputSchema
})
const uuidRequestSchema = z.object({ id: uuidSchema })
const stockMovementListSchema = z.object({
  productId: uuidSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100)
})
const productImportSchema = z.array(productInputSchema).min(1).max(2000)

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

function handle<TInput, TOutput>(
  channel: string,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry,
  schema: z.ZodType<TInput>,
  action: (input: TInput) => TOutput
): void {
  registry.handle(channel, (event, value) => {
    if (event.sender !== trustedContents()) {
      throw new Error('Rejected request from an untrusted renderer')
    }

    const input = parse(schema, value)
    try {
      return action(input)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error('A category name, SKU, or barcode is already in use')
      }
      throw error
    }
  })
}

export function registerCatalogIpc(
  repository: CatalogRepository,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  handle('catalog:categories:list', trustedContents, registry, categoryListSchema, ({ includeArchived }) =>
    repository.listCategories(includeArchived))
  handle('catalog:categories:create', trustedContents, registry, categoryInputSchema, (input) =>
    repository.createCategory(input))
  handle('catalog:categories:update', trustedContents, registry, categoryUpdateRequestSchema, ({ id, input }) =>
    repository.updateCategory(id, input))
  handle('catalog:categories:archive', trustedContents, registry, uuidRequestSchema, ({ id }) =>
    repository.archiveCategory(id))
  handle('catalog:categories:restore', trustedContents, registry, uuidRequestSchema, ({ id }) =>
    repository.restoreCategory(id))
  handle('catalog:products:list', trustedContents, registry, productSearchSchema, ({ search, includeArchived }) =>
    repository.listProducts(search, includeArchived))
  handle('catalog:products:create', trustedContents, registry, productInputSchema, (input) =>
    repository.createProduct(input))
  handle('catalog:products:import', trustedContents, registry, productImportSchema, (inputs) =>
    repository.importProducts(inputs))
  handle('catalog:products:update', trustedContents, registry, productUpdateRequestSchema, ({ id, input }) =>
    repository.updateProduct(id, input))
  handle('catalog:products:archive', trustedContents, registry, uuidRequestSchema, ({ id }) =>
    repository.archiveProduct(id))
  handle('catalog:products:restore', trustedContents, registry, uuidRequestSchema, ({ id }) =>
    repository.restoreProduct(id))
  handle('catalog:stock:adjust', trustedContents, registry, stockAdjustmentSchema, (input) =>
    repository.adjustStock(input))
  handle('catalog:stock:reconcile', trustedContents, registry, stockReconciliationSchema, (input) =>
    repository.reconcileStock(input))
  handle('catalog:stock:history', trustedContents, registry, stockMovementListSchema, ({ productId, limit }) =>
    repository.listStockMovements(productId, limit))
}

export function removeCatalogIpc(registry: IpcHandlerRegistry): void {
  for (const channel of [
    'catalog:categories:list',
    'catalog:categories:create',
    'catalog:categories:update',
    'catalog:categories:archive',
    'catalog:categories:restore',
    'catalog:products:list',
    'catalog:products:create',
    'catalog:products:import',
    'catalog:products:update',
    'catalog:products:archive',
    'catalog:products:restore',
    'catalog:stock:adjust',
    'catalog:stock:reconcile',
    'catalog:stock:history'
  ]) {
    registry.removeHandler(channel)
  }
}
