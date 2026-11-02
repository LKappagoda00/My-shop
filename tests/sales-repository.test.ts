// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CatalogRepository } from '../electron/database/catalog-repository'
import { CashRepository } from '../electron/database/cash-repository'
import { HeldSalesRepository } from '../electron/database/held-sales-repository'
import { migrateDatabase } from '../electron/database/migrations'
import { SalesRepository } from '../electron/database/sales-repository'
import { calculateSaleTotals, type SaleInput } from '../src/shared/sales'

describe('offline sales', () => {
  let database: DatabaseSync
  let catalog: CatalogRepository
  let sales: SalesRepository
  let cash: CashRepository
  let firstProductId: string
  let secondProductId: string

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    catalog = new CatalogRepository(database)
    cash = new CashRepository(database)
    cash.openSession({ openingCashMinor: 100000 })
    sales = new SalesRepository(database)
    firstProductId = catalog.createProduct({
      name: 'Tea',
      sku: 'TEA-01',
      barcode: '',
      categoryId: null,
      unit: 'piece',
      costPriceMinor: 500,
      sellingPriceMinor: 1250,
      minimumStockMilli: 0,
      openingStockMilli: 3000
    }).id
    secondProductId = catalog.createProduct({
      name: 'Sugar',
      sku: 'SUGAR-01',
      barcode: '',
      categoryId: null,
      unit: 'kg',
      costPriceMinor: 200,
      sellingPriceMinor: 1000,
      minimumStockMilli: 0,
      openingStockMilli: 3000
    }).id
  })

  afterEach(() => {
    database.close()
  })

  function checkoutInput(idempotencyKey = randomUUID()): SaleInput {
    return {
      idempotencyKey,
      billDiscountMinor: 100,
      lines: [
        { productId: firstProductId, quantityMilli: 1500, lineDiscountMinor: 75 },
        { productId: secondProductId, quantityMilli: 1000, lineDiscountMinor: 0 }
      ],
      payments: [
        { method: 'cash', amountMinor: 1000, amountReceivedMinor: 1500 },
        { method: 'card', amountMinor: 1700 }
      ]
    }
  }

  it('calculates exact line discounts, bill discount allocations, and cost snapshots', () => {
    const products = catalog.listProducts()
    const totals = calculateSaleTotals(products, [
      { productId: products[0].id, quantityMilli: 1000, lineDiscountMinor: 0 },
      { productId: products[1].id, quantityMilli: 1000, lineDiscountMinor: 0 }
    ], 100)

    expect(totals.grossSalesMinor).toBe(1000 + 1250)
    expect(totals.netSalesMinor).toBe(totals.grossSalesMinor - 100)
    expect(totals.lines.reduce((sum, line) => sum + line.allocatedBillDiscountMinor, 0)).toBe(100)
  })

  it('commits sale, payments, stock movements, and snapshots atomically', () => {
    const sale = sales.createSale(checkoutInput())

    expect(sale.invoiceNumber).toMatch(/^INV-\d{8}-\d{6}$/)
    expect(sale.grossSalesMinor).toBe(2875)
    expect(sale.lineDiscountsMinor).toBe(75)
    expect(sale.billDiscountMinor).toBe(100)
    expect(sale.netSalesMinor).toBe(2700)
    expect(sale.costOfGoodsMinor).toBe(950)
    expect(sale.items.reduce((sum, line) => sum + line.allocatedBillDiscountMinor, 0)).toBe(100)
    expect(sale.payments[0]).toMatchObject({
      amountMinor: 1000,
      amountReceivedMinor: 1500,
      changeMinor: 500
    })
    expect(catalog.listProducts().find((item) => item.id === firstProductId)?.stockOnHandMilli).toBe(1500)
    expect(catalog.listProducts().find((item) => item.id === secondProductId)?.stockOnHandMilli).toBe(2000)

    catalog.updateProduct(firstProductId, {
      name: 'Tea updated',
      sku: 'TEA-01',
      barcode: '',
      categoryId: null,
      unit: 'piece',
      costPriceMinor: 800,
      sellingPriceMinor: 1500,
      minimumStockMilli: 0
    })
    expect(sales.getSale(sale.id)?.items[0]).toMatchObject({
      productName: 'Tea',
      unitCostMinor: 500,
      unitPriceMinor: 1250
    })
  })

  it('returns an existing result for a duplicate idempotency key without deducting stock twice', () => {
    const input = checkoutInput()
    const first = sales.createSale(input)
    const duplicate = sales.createSale(input)

    expect(duplicate.id).toBe(first.id)
    expect(duplicate.invoiceNumber).toBe(first.invoiceNumber)
    expect(catalog.listProducts().find((item) => item.id === firstProductId)?.stockOnHandMilli).toBe(1500)
    expect(database.prepare("SELECT COUNT(*) AS count FROM sales WHERE status = 'completed'").get()).toEqual({ count: 1 })
  })

  it('removes a held sale atomically with successful checkout', () => {
    const heldSales = new HeldSalesRepository(database)
    const heldSaleId = randomUUID()
    const lines = [{ productId: firstProductId, quantityMilli: 1000, lineDiscountMinor: 0 }]
    heldSales.saveHeldSale({
      id: heldSaleId,
      title: 'Customer at counter',
      billDiscountMinor: 0,
      lines
    })
    expect(heldSales.listHeldSales()).toHaveLength(1)

    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      heldSaleId,
      billDiscountMinor: 0,
      lines,
      payments: [{ method: 'cash', amountMinor: 1250, amountReceivedMinor: 1250 }]
    })
    expect(sale.netSalesMinor).toBe(1250)
    expect(heldSales.listHeldSales()).toHaveLength(0)
  })

  it('keeps a held cart and rolls back checkout when its held record is missing', () => {
    const stockBefore = catalog.listProducts().find((item) => item.id === firstProductId)?.stockOnHandMilli
    expect(() => sales.createSale({
      idempotencyKey: randomUUID(),
      heldSaleId: randomUUID(),
      billDiscountMinor: 0,
      lines: [{ productId: firstProductId, quantityMilli: 1000, lineDiscountMinor: 0 }],
      payments: [{ method: 'cash', amountMinor: 1250, amountReceivedMinor: 1250 }]
    })).toThrow('Held sale was not found; checkout was cancelled')
    expect(catalog.listProducts().find((item) => item.id === firstProductId)?.stockOnHandMilli).toBe(stockBefore)
    expect(sales.listSales()).toHaveLength(0)
  })

  it('voids a completed sale, restores stock, and refunds the original tenders', () => {
    const sale = sales.createSale(checkoutInput())
    const voided = sales.voidSale({ id: sale.id, reason: 'Duplicate checkout' })

    expect(voided).toMatchObject({
      status: 'voided',
      voidReason: 'Duplicate checkout',
      voidPayments: [
        { method: 'cash', amountMinor: 1000 },
        { method: 'card', amountMinor: 1700 }
      ]
    })
    expect(catalog.listProducts().find((item) => item.id === firstProductId)?.stockOnHandMilli).toBe(3000)
    expect(catalog.listProducts().find((item) => item.id === secondProductId)?.stockOnHandMilli).toBe(3000)
    expect(cash.getStatus().current?.expectedCashMinor).toBe(100000)
    expect(() => sales.voidSale({ id: sale.id, reason: 'Second attempt' }))
      .toThrow('Only completed, unreturned sales can be voided')
  })

  it('rolls back a void when the cash drawer cannot cover the refund', () => {
    const sale = sales.createSale(checkoutInput())
    cash.recordManualMovement({ direction: 'out', amountMinor: 101000, reason: 'Cash removed' })

    expect(() => sales.voidSale({ id: sale.id, reason: 'Customer cancellation' }))
      .toThrow('Cash movement would make the drawer balance negative')
    expect(sales.getSale(sale.id)?.status).toBe('completed')
    expect(catalog.listProducts().find((item) => item.id === firstProductId)?.stockOnHandMilli).toBe(1500)
    expect(database.prepare('SELECT COUNT(*) AS count FROM sale_void_payments').get()).toEqual({ count: 0 })
  })

  it('rejects reusing an idempotency key with changed checkout data', () => {
    const input = checkoutInput()
    sales.createSale(input)

    expect(() => sales.createSale({
      ...input,
      billDiscountMinor: 99
    })).toThrow('Idempotency key was already used for a different checkout')
  })

  it('rolls back all records when checkout exceeds stock or payment is not exact', () => {
    const input = checkoutInput()
    expect(() => sales.createSale({
      ...input,
      lines: [{ productId: firstProductId, quantityMilli: 4000, lineDiscountMinor: 0 }],
      payments: [{ method: 'cash', amountMinor: 4900 }]
    })).toThrow('Not enough stock for Tea')

    expect(() => sales.createSale({
      ...input,
      payments: [{ method: 'card', amountMinor: 2699 }]
    })).toThrow('Payments must exactly cover the sale total; partial payments are not enabled')

    expect(sales.listSales()).toHaveLength(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM sale_items').get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE movement_type = 'sale'").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE entity_type = 'sale'").get()).toEqual({ count: 0 })
  })
})
