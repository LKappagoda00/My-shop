// @vitest-environment node

import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CatalogRepository } from '../electron/database/catalog-repository'
import { CashRepository } from '../electron/database/cash-repository'
import { migrateDatabase } from '../electron/database/migrations'
import { ProcurementRepository } from '../electron/database/procurement-repository'
import { ExpenseInput, PurchaseDraftInput } from '../src/shared/procurement'

describe('suppliers, purchases, and expenses', () => {
  let database: DatabaseSync
  let catalog: CatalogRepository
  let procurement: ProcurementRepository
  let supplierId: string
  let productId: string

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    catalog = new CatalogRepository(database)
    procurement = new ProcurementRepository(database)
    new CashRepository(database).openSession({ openingCashMinor: 100000 })
    supplierId = procurement.createSupplier({
      name: 'Island Foods',
      phone: '011 555 1000',
      address: 'Colombo',
      notes: ''
    }).id
    productId = catalog.createProduct({
      name: 'Coconut milk',
      sku: 'COCO-1',
      barcode: '',
      categoryId: null,
      unit: 'piece',
      costPriceMinor: 400,
      sellingPriceMinor: 650,
      minimumStockMilli: 0,
      openingStockMilli: 1000
    }).id
  })

  afterEach(() => {
    database.close()
  })

  function purchaseDraft(invoice = 'INV-ISLAND-1'): PurchaseDraftInput {
    return {
      supplierId,
      supplierInvoiceNumber: invoice,
      additionalCostsMinor: 100,
      items: [{ productId, quantityMilli: 2000, unitCostMinor: 500 }]
    }
  }

  it('creates drafts without changing stock and receives inventory with landed weighted-average cost', () => {
    const draft = procurement.createPurchaseDraft(purchaseDraft())
    expect(draft.status).toBe('draft')
    expect(draft.totalCostMinor).toBe(1100)
    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(1000)

    const received = procurement.receivePurchase({
      id: draft.id,
      payments: [{ method: 'cash', amountMinor: 400, reference: 'cash counter' }]
    })
    expect(received.status).toBe('received')
    expect(received.balanceMinor).toBe(700)
    expect(received.items[0].landedCostMinor).toBe(100)
    expect(database.prepare('SELECT received_business_date FROM purchases WHERE id = ?').get(draft.id))
      .toEqual({ received_business_date: expect.any(String) })
    expect(database.prepare('SELECT business_date FROM supplier_payments WHERE purchase_id = ?').get(draft.id))
      .toEqual({ business_date: expect.any(String) })
    expect(catalog.listProducts()[0]).toMatchObject({
      stockOnHandMilli: 3000,
      costPriceMinor: 500
    })

    const movement = database.prepare(`
      SELECT quantity_delta_milli, unit_cost_minor
      FROM stock_movements WHERE movement_type = 'purchase'
    `).get()
    expect(movement).toEqual({ quantity_delta_milli: 2000, unit_cost_minor: 550 })
  })

  it('records supplier balances and prevents payments above the outstanding debt', () => {
    const draft = procurement.createPurchaseDraft(purchaseDraft())
    procurement.receivePurchase({ id: draft.id, payments: [] })
    const afterPayment = procurement.recordSupplierPayment({
      purchaseId: draft.id,
      method: 'bank_transfer',
      amountMinor: 500,
      reference: 'BANK-001'
    })
    expect(afterPayment.balanceMinor).toBe(600)
    expect(database.prepare("SELECT COUNT(*) AS count FROM supplier_payments WHERE purchase_id = ? AND business_date != ''").get(draft.id))
      .toEqual({ count: 1 })
    expect(procurement.listSuppliers()[0].outstandingMinor).toBe(600)
    expect(() => procurement.recordSupplierPayment({
      purchaseId: draft.id,
      method: 'cash',
      amountMinor: 601,
      reference: ''
    })).toThrow('Supplier payment cannot exceed the outstanding purchase balance')
  })

  it('rolls back receiving when initial payments exceed the purchase total', () => {
    const draft = procurement.createPurchaseDraft(purchaseDraft())
    expect(() => procurement.receivePurchase({
      id: draft.id,
      payments: [{ method: 'cash', amountMinor: 1101, reference: '' }]
    })).toThrow('Purchase payments cannot exceed the received purchase total')

    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(1000)
    expect(procurement.listPurchases()[0].status).toBe('draft')
    expect(database.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE movement_type = 'purchase'").get()).toEqual({ count: 0 })
  })

  it('rejects duplicate supplier invoice numbers', () => {
    procurement.createPurchaseDraft(purchaseDraft('SUP-42'))
    expect(() => procurement.createPurchaseDraft(purchaseDraft('SUP-42'))).toThrow()
    expect(procurement.listPurchases()).toHaveLength(1)
  })

  it('reopens a cancelled purchase draft so goods receipt and payment can be confirmed', () => {
    const draft = procurement.createPurchaseDraft(purchaseDraft())
    procurement.cancelPurchaseDraft(draft.id)

    const reopened = procurement.reopenCancelledPurchase(draft.id)

    expect(reopened.status).toBe('draft')
    expect(reopened.items).toHaveLength(1)
    expect(procurement.receivePurchase({
      id: draft.id,
      payments: [{ method: 'cash', amountMinor: 1100, reference: 'Paid at delivery' }]
    })).toMatchObject({ status: 'received', amountPaidMinor: 1100, balanceMinor: 0 })
    expect(catalog.listProducts()[0].stockOnHandMilli).toBe(3000)
    expect(database.prepare(`
      SELECT action FROM audit_logs WHERE entity_type = 'purchase' AND entity_id = ?
      ORDER BY created_at
    `).all(draft.id)).toEqual([
      { action: 'purchase.draft_created' },
      { action: 'purchase.draft_cancelled' },
      { action: 'purchase.draft_reopened' },
      { action: 'purchase.received' }
    ])
  })

  it('cannot reopen a received purchase or a cancelled purchase with prior payments', () => {
    const received = procurement.createPurchaseDraft(purchaseDraft('RECEIVED-1'))
    procurement.receivePurchase({ id: received.id, payments: [] })
    expect(() => procurement.reopenCancelledPurchase(received.id)).toThrow(
      'Only an unpaid, unreceived cancelled purchase can be reopened'
    )

    const cancelled = procurement.createPurchaseDraft(purchaseDraft('CANCELLED-1'))
    procurement.cancelPurchaseDraft(cancelled.id)
    database.prepare(`
      INSERT INTO supplier_payments (
        id, purchase_id, supplier_id, method, amount_minor, reference, created_at, business_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('payment-test', cancelled.id, supplierId, 'cash', 100, '', new Date().toISOString(), '2026-10-30')
    expect(() => procurement.reopenCancelledPurchase(cancelled.id)).toThrow(
      'Only an unpaid, unreceived cancelled purchase can be reopened'
    )
  })

  it('records expenses separately from inventory purchases and supports archive', () => {
    const category = procurement.listExpenseCategories().find((item) => item.name === 'Electricity')
    expect(category).toBeDefined()
    const input: ExpenseInput = {
      categoryId: category!.id,
      description: 'October electricity',
      amountMinor: 12500,
      method: 'cash',
      businessDate: '2026-10-29'
    }
    const expense = procurement.createExpense(input)
    expect(expense.amountMinor).toBe(12500)
    expect(procurement.listExpenses()).toHaveLength(1)
    procurement.archiveExpense(expense.id)
    expect(procurement.listExpenses()).toHaveLength(0)
    expect(procurement.listExpenses('', undefined, undefined, true)[0].archived).toBe(true)
    procurement.restoreExpense(expense.id)
    expect(procurement.listExpenses()).toHaveLength(1)
    expect(procurement.listExpenses()[0].archived).toBe(false)
    expect(procurement.listPurchases()).toHaveLength(0)
  })
})
