// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CatalogRepository } from '../electron/database/catalog-repository'
import { CashRepository } from '../electron/database/cash-repository'
import { migrateDatabase } from '../electron/database/migrations'
import { ReturnsRepository } from '../electron/database/returns-repository'
import { SalesRepository } from '../electron/database/sales-repository'

describe('sales returns', () => {
  let database: DatabaseSync
  let catalog: CatalogRepository
  let sales: SalesRepository
  let returns: ReturnsRepository
  let productId: string
  let saleId: string
  let saleItemId: string

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    catalog = new CatalogRepository(database)
    new CashRepository(database).openSession({ openingCashMinor: 10000 })
    sales = new SalesRepository(database)
    returns = new ReturnsRepository(database)
    productId = catalog.createProduct({
      name: 'Biscuits',
      sku: 'BIS-01',
      barcode: '',
      categoryId: null,
      unit: 'piece',
      costPriceMinor: 300,
      sellingPriceMinor: 1000,
      minimumStockMilli: 0,
      openingStockMilli: 3000
    }).id
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      billDiscountMinor: 100,
      lines: [{ productId, quantityMilli: 3000, lineDiscountMinor: 0 }],
      payments: [{ method: 'cash', amountMinor: 2900, amountReceivedMinor: 3000 }]
    })
    saleId = sale.id
    saleItemId = sale.items[0].id
  })

  afterEach(() => {
    database.close()
  })

  it('creates partial returns, proportionally refunds discounts, and restocks only approved items', () => {
    const first = returns.createReturn({
      saleId,
      idempotencyKey: randomUUID(),
      reason: 'One package returned resalable',
      refundMethod: 'cash',
      lines: [{ saleItemId, quantityMilli: 1000, restock: true }]
    })
    expect(first.refundMinor).toBe(967)
    expect(() => sales.voidSale({ id: saleId, reason: 'Void after return' }))
      .toThrow('Only completed, unreturned sales can be voided')
    expect(first.costReversalMinor).toBe(300)
    expect(first.items[0].restocked).toBe(true)
    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(1000)
    expect(sales.getSale(saleId)?.items[0].returnableQuantityMilli).toBe(2000)

    const second = returns.createReturn({
      saleId,
      idempotencyKey: randomUUID(),
      reason: 'One package damaged',
      refundMethod: 'bank_transfer',
      lines: [{ saleItemId, quantityMilli: 1000, restock: false }]
    })
    expect(second.refundMinor).toBe(966)
    expect(second.costReversalMinor).toBe(0)
    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(1000)

    const final = returns.createReturn({
      saleId,
      idempotencyKey: randomUUID(),
      reason: 'Final package returned',
      refundMethod: 'card',
      lines: [{ saleItemId, quantityMilli: 1000, restock: true }]
    })
    expect(final.refundMinor).toBe(967)
    expect(final.costReversalMinor).toBe(300)
    expect(sales.getSale(saleId)?.status).toBe('returned')
    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(2000)
    expect(returns.listReturns()).toHaveLength(3)
  })

  it('rejects excess returns and preserves stock and sale state', () => {
    expect(() => returns.createReturn({
      saleId,
      idempotencyKey: randomUUID(),
      reason: 'Excess quantity',
      refundMethod: 'cash',
      lines: [{ saleItemId, quantityMilli: 4000, restock: true }]
    })).toThrow('Return quantity exceeds the remaining eligible quantity for Biscuits')
    expect(sales.getSale(saleId)?.status).toBe('completed')
    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(0)
    expect(returns.listReturns()).toHaveLength(0)
  })

  it('is idempotent and rejects a reused return key with changed details', () => {
    const input = {
      saleId,
      idempotencyKey: randomUUID(),
      reason: 'Customer changed mind',
      refundMethod: 'cash' as const,
      lines: [{ saleItemId, quantityMilli: 1000, restock: true }]
    }
    const first = returns.createReturn(input)
    const repeated = returns.createReturn(input)
    expect(repeated.id).toBe(first.id)
    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(1000)
    expect(() => returns.createReturn({ ...input, reason: 'Changed reason' }))
      .toThrow('Idempotency key was already used for a different return')
  })
})
