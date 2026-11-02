// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CatalogRepository } from '../electron/database/catalog-repository'
import { CashRepository } from '../electron/database/cash-repository'
import { migrateDatabase } from '../electron/database/migrations'
import { ProcurementRepository } from '../electron/database/procurement-repository'
import { ReportsRepository } from '../electron/database/reports-repository'
import { ReturnsRepository } from '../electron/database/returns-repository'
import { SalesRepository } from '../electron/database/sales-repository'
import { sriLankaBusinessDate } from '../src/shared/business-date'

describe('ReportsRepository', () => {
  let database: DatabaseSync
  let reports: ReportsRepository
  let businessDate: string

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    reports = new ReportsRepository(database)
    businessDate = sriLankaBusinessDate()
  })

  afterEach(() => {
    database.close()
  })

  it('reconciles discounts, returns, cost reversals, expenses, and inventory reports', () => {
    const catalog = new CatalogRepository(database)
    const cash = new CashRepository(database)
    const procurement = new ProcurementRepository(database)
    const sales = new SalesRepository(database)
    const returns = new ReturnsRepository(database)
    cash.openSession({ openingCashMinor: 10000 })

    const product = catalog.createProduct({
      name: 'Tea pack',
      sku: 'TEA-01',
      barcode: '',
      categoryId: null,
      unit: 'piece',
      costPriceMinor: 500,
      sellingPriceMinor: 1000,
      minimumStockMilli: 2500,
      openingStockMilli: 3000
    })
    const sale = sales.createSale({
      idempotencyKey: randomUUID(),
      billDiscountMinor: 100,
      lines: [{ productId: product.id, quantityMilli: 2000, lineDiscountMinor: 0 }],
      payments: [{ method: 'cash', amountMinor: 1900, amountReceivedMinor: 2000 }]
    })
    returns.createReturn({
      saleId: sale.id,
      idempotencyKey: randomUUID(),
      reason: 'One item returned',
      refundMethod: 'cash',
      lines: [{ saleItemId: sale.items[0].id, quantityMilli: 1000, restock: true }]
    })
    const electricity = procurement.listExpenseCategories().find((category) => category.name === 'Electricity')
    if (!electricity) throw new Error('Electricity expense category was not seeded')
    procurement.createExpense({
      categoryId: electricity.id,
      description: 'Daily electricity',
      amountMinor: 200,
      method: 'cash',
      businessDate
    })

    const report = reports.getReport({ fromDate: businessDate, toDate: businessDate })
    expect(report.totals).toMatchObject({
      grossSalesMinor: 2000,
      discountsMinor: 100,
      returnsMinor: 950,
      netSalesMinor: 950,
      costOfGoodsMinor: 500,
      grossProfitMinor: 450,
      expensesMinor: 200,
      netProfitMinor: 250,
      cashReceivedMinor: 1900,
      cashPaidMinor: 1150,
      stockValueMinor: 1000
    })
    expect(report.daily).toEqual([expect.objectContaining({
      businessDate,
      netSalesMinor: 950,
      netProfitMinor: 250
    })])
    expect(report.bestSelling).toEqual([expect.objectContaining({
      productId: product.id,
      quantitySoldMilli: 1000,
      netSalesMinor: 950,
      costOfGoodsMinor: 500,
      grossProfitMinor: 450
    })])
    expect(report.expensesByCategory).toEqual([{ category: 'Electricity', amountMinor: 200 }])
    expect(report.lowStock).toEqual([expect.objectContaining({
      id: product.id,
      stockOnHandMilli: 2000,
      minimumStockMilli: 2500
    })])
  })

  it('rejects reversed date ranges', () => {
    expect(() => reports.getReport({ fromDate: '2026-03-02', toDate: '2026-03-01' }))
      .toThrow('Report start date must be on or before its end date')
  })
})
