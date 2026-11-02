import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Category,
  CategoryInput,
  Product,
  ProductInput,
  ProductUpdate,
  StockAdjustmentInput,
  StockMovement,
  StockReconciliationInput
} from '../../src/shared/catalog'
import {
  appendAudit,
  appendSyncOperation,
  requireChanged,
  withTransaction
} from './primitives'

interface CategoryRow {
  id: string
  name: string
  description: string
  archived: number
  created_at: string
  updated_at: string
}

interface ProductRow {
  id: string
  name: string
  sku: string
  barcode: string | null
  category_id: string | null
  category_name: string | null
  unit: Product['unit']
  cost_price_minor: number
  selling_price_minor: number
  minimum_stock_milli: number
  stock_on_hand_milli: number
  archived: number
  created_at: string
  updated_at: string
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    categoryId: row.category_id,
    categoryName: row.category_name,
    unit: row.unit,
    costPriceMinor: row.cost_price_minor,
    sellingPriceMinor: row.selling_price_minor,
    minimumStockMilli: row.minimum_stock_milli,
    stockOnHandMilli: row.stock_on_hand_milli,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class CatalogRepository {
  constructor(private readonly database: DatabaseSync) {}

  listCategories(includeArchived = false): Category[] {
    const rows = this.database.prepare(`
      SELECT id, name, description, archived, created_at, updated_at
      FROM categories
      WHERE (? = 1 OR archived = 0)
      ORDER BY name COLLATE NOCASE
    `).all(includeArchived ? 1 : 0) as unknown as CategoryRow[]
    return rows.map(mapCategory)
  }

  createCategory(input: CategoryInput): Category {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO categories (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, input.name, input.description, timestamp, timestamp)

      appendAudit(this.database, 'category.created', 'category', id, input)
      appendSyncOperation(this.database, 'category', id, 'upsert', { id, ...input })
    })

    return this.listCategories(true).find((category) => category.id === id)!
  }

  updateCategory(id: string, input: CategoryInput): Category {
    const timestamp = new Date().toISOString()
    withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE categories SET name = ?, description = ?, updated_at = ?
        WHERE id = ? AND archived = 0
      `).run(input.name, input.description, timestamp, id)
      requireChanged(result.changes, 'Category was not found or is archived')
      appendAudit(this.database, 'category.updated', 'category', id, input)
      appendSyncOperation(this.database, 'category', id, 'upsert', { id, ...input })
    })

    const category = this.listCategories(true).find((item) => item.id === id)
    if (!category) throw new Error('Updated category could not be loaded')
    return category
  }

  archiveCategory(id: string): void {
    withTransaction(this.database, () => {
      const timestamp = new Date().toISOString()
      const result = this.database.prepare(`
        UPDATE categories SET archived = 1, updated_at = ?
        WHERE id = ? AND archived = 0
      `).run(timestamp, id)
      requireChanged(result.changes, 'Category was not found or is already archived')
      appendAudit(this.database, 'category.archived', 'category', id, {})
      appendSyncOperation(this.database, 'category', id, 'archive', { id })
    })
  }

  restoreCategory(id: string): void {
    withTransaction(this.database, () => {
      const timestamp = new Date().toISOString()
      const result = this.database.prepare(`
        UPDATE categories SET archived = 0, updated_at = ?
        WHERE id = ? AND archived = 1
      `).run(timestamp, id)
      requireChanged(result.changes, 'Archived category was not found')
      appendAudit(this.database, 'category.restored', 'category', id, {})
      appendSyncOperation(this.database, 'category', id, 'upsert', { id })
    })
  }

  listProducts(search = '', includeArchived = false): Product[] {
    const needle = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
    const rows = this.database.prepare(`
      SELECT p.id, p.name, p.sku, p.barcode, p.category_id, c.name AS category_name,
        p.unit, p.cost_price_minor, p.selling_price_minor, p.minimum_stock_milli,
        COALESCE(SUM(sm.quantity_delta_milli), 0) AS stock_on_hand_milli,
        p.archived, p.created_at, p.updated_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE (? = '' OR p.name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR p.sku LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR COALESCE(p.barcode, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)
        AND (? = 1 OR p.archived = 0)
      GROUP BY p.id
      ORDER BY p.name COLLATE NOCASE
    `).all(search.trim(), needle, needle, needle, includeArchived ? 1 : 0) as unknown as ProductRow[]
    return rows.map(mapProduct)
  }

  createProduct(input: ProductInput): Product {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO products (
          id, name, sku, barcode, category_id, unit, cost_price_minor,
          selling_price_minor, minimum_stock_milli, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.name, input.sku, input.barcode || null, input.categoryId, input.unit,
        input.costPriceMinor, input.sellingPriceMinor, input.minimumStockMilli, timestamp, timestamp
      )

      if (input.openingStockMilli > 0) {
        this.insertMovement(id, 'opening', input.openingStockMilli, input.costPriceMinor, 'Opening stock')
      }

      appendAudit(this.database, 'product.created', 'product', id, input)
      appendSyncOperation(this.database, 'product', id, 'upsert', { id, ...input })
    })

    const product = this.listProducts().find((item) => item.id === id)
    if (!product) throw new Error('Created product could not be loaded')
    return product
  }

  updateProduct(id: string, input: ProductUpdate): Product {
    withTransaction(this.database, () => {
      const timestamp = new Date().toISOString()
      const result = this.database.prepare(`
        UPDATE products
        SET name = ?, sku = ?, barcode = ?, category_id = ?, unit = ?,
          cost_price_minor = ?, selling_price_minor = ?, minimum_stock_milli = ?, updated_at = ?
        WHERE id = ? AND archived = 0
      `).run(
        input.name, input.sku, input.barcode || null, input.categoryId, input.unit,
        input.costPriceMinor, input.sellingPriceMinor, input.minimumStockMilli, timestamp, id
      )
      requireChanged(result.changes, 'Product was not found or is archived')
      appendAudit(this.database, 'product.updated', 'product', id, input)
      appendSyncOperation(this.database, 'product', id, 'upsert', { id, ...input })
    })

    const product = this.listProducts().find((item) => item.id === id)
    if (!product) throw new Error('Updated product could not be loaded')
    return product
  }

  archiveProduct(id: string): void {
    withTransaction(this.database, () => {
      const timestamp = new Date().toISOString()
      const result = this.database.prepare(`
        UPDATE products SET archived = 1, updated_at = ?
        WHERE id = ? AND archived = 0
      `).run(timestamp, id)
      requireChanged(result.changes, 'Product was not found or is already archived')
      appendAudit(this.database, 'product.archived', 'product', id, {})
      appendSyncOperation(this.database, 'product', id, 'archive', { id })
    })
  }

  restoreProduct(id: string): void {
    withTransaction(this.database, () => {
      const timestamp = new Date().toISOString()
      const result = this.database.prepare(`
        UPDATE products SET archived = 0, updated_at = ?
        WHERE id = ? AND archived = 1
      `).run(timestamp, id)
      requireChanged(result.changes, 'Archived product was not found')
      appendAudit(this.database, 'product.restored', 'product', id, {})
      appendSyncOperation(this.database, 'product', id, 'upsert', { id })
    })
  }

  adjustStock(input: StockAdjustmentInput): Product {
    withTransaction(this.database, () => {
      const product = this.database.prepare(`
        SELECT cost_price_minor FROM products WHERE id = ? AND archived = 0
      `).get(input.productId) as { cost_price_minor: number } | undefined
      if (!product) throw new Error('Product was not found or is archived')

      const balance = this.getStockBalance(input.productId)
      if (balance + input.quantityDeltaMilli < 0) {
        throw new Error('Stock adjustment cannot reduce inventory below zero')
      }

      this.insertMovement(
        input.productId,
        'adjustment',
        input.quantityDeltaMilli,
        product.cost_price_minor,
        input.reason
      )
      appendAudit(this.database, 'stock.adjusted', 'product', input.productId, input)
      appendSyncOperation(this.database, 'stock_movement', input.productId, 'adjustment', input)
    })

    const product = this.listProducts().find((item) => item.id === input.productId)
    if (!product) throw new Error('Adjusted product could not be loaded')
    return product
  }

  importProducts(inputs: ProductInput[]): Product[] {
    const importedIds: string[] = []
    withTransaction(this.database, () => {
      const timestamp = new Date().toISOString()
      const insertProduct = this.database.prepare(`
        INSERT INTO products (
          id, name, sku, barcode, category_id, unit, cost_price_minor,
          selling_price_minor, minimum_stock_milli, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const input of inputs) {
        const id = randomUUID()
        insertProduct.run(
          id, input.name, input.sku, input.barcode || null, input.categoryId, input.unit,
          input.costPriceMinor, input.sellingPriceMinor, input.minimumStockMilli, timestamp, timestamp
        )
        if (input.openingStockMilli > 0) {
          this.insertMovement(id, 'opening', input.openingStockMilli, input.costPriceMinor, 'Opening stock imported')
        }
        appendAudit(this.database, 'product.imported', 'product', id, input)
        appendSyncOperation(this.database, 'product', id, 'upsert', { id, ...input })
        importedIds.push(id)
      }
    })

    const imported = new Set(importedIds)
    return this.listProducts('', true).filter((product) => imported.has(product.id))
  }

  reconcileStock(input: StockReconciliationInput): Product {
    withTransaction(this.database, () => {
      const product = this.database.prepare(`
        SELECT cost_price_minor FROM products WHERE id = ? AND archived = 0
      `).get(input.productId) as { cost_price_minor: number } | undefined
      if (!product) throw new Error('Product was not found or is archived')

      const balance = this.getStockBalance(input.productId)
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw new Error('Current stock balance exceeds the supported quantity range')
      }
      const quantityDeltaMilli = input.countedQuantityMilli - balance
      if (!Number.isSafeInteger(quantityDeltaMilli)) {
        throw new Error('Stock count difference exceeds the supported quantity range')
      }
      if (quantityDeltaMilli !== 0) {
        this.insertMovement(
          input.productId,
          'adjustment',
          quantityDeltaMilli,
          product.cost_price_minor,
          `Stock count: ${input.reason}`
        )
        appendAudit(this.database, 'stock.reconciled', 'product', input.productId, {
          ...input,
          previousQuantityMilli: balance,
          quantityDeltaMilli
        })
        appendSyncOperation(this.database, 'stock_movement', input.productId, 'adjustment', {
          ...input,
          quantityDeltaMilli
        })
      }
    })

    const product = this.listProducts().find((item) => item.id === input.productId)
    if (!product) throw new Error('Reconciled product could not be loaded')
    return product
  }

  listStockMovements(productId?: string, limit = 100): StockMovement[] {
    const rows = this.database.prepare(`
      SELECT sm.id, sm.product_id, p.name AS product_name, p.sku, sm.movement_type,
        sm.quantity_delta_milli, sm.unit_cost_minor, sm.reason, sm.reference_id, sm.created_at
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE (? IS NULL OR sm.product_id = ?)
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT ?
    `).all(productId ?? null, productId ?? null, limit) as unknown as Array<{
      id: string
      product_id: string
      product_name: string
      sku: string
      movement_type: StockMovement['movementType']
      quantity_delta_milli: number
      unit_cost_minor: number
      reason: string
      reference_id: string | null
      created_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      movementType: row.movement_type,
      quantityDeltaMilli: row.quantity_delta_milli,
      unitCostMinor: row.unit_cost_minor,
      reason: row.reason,
      referenceId: row.reference_id,
      createdAt: row.created_at
    }))
  }

  private getStockBalance(productId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(quantity_delta_milli), 0) AS balance
      FROM stock_movements WHERE product_id = ?
    `).get(productId) as { balance: number }
    return row.balance
  }

  private insertMovement(
    productId: string,
    movementType: 'opening' | 'adjustment',
    quantityDeltaMilli: number,
    unitCostMinor: number,
    reason: string
  ): void {
    this.database.prepare(`
      INSERT INTO stock_movements (
        id, product_id, movement_type, quantity_delta_milli, unit_cost_minor, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), productId, movementType, quantityDeltaMilli, unitCostMinor, reason, new Date().toISOString())
  }

}
