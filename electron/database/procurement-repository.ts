import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Product } from '../../src/shared/catalog'
import { sriLankaBusinessDate } from '../../src/shared/business-date'
import {
  allocateMinorProportionally,
  roundMinorProduct,
  weightedAverageCostMinor
} from '../../src/shared/financial'
import type {
  Expense,
  ExpenseCategory,
  ExpenseInput,
  PurchaseDetail,
  PurchaseDraftInput,
  PurchaseItem,
  PurchasePayment,
  PurchaseSummary,
  ReceivePurchaseInput,
  Supplier,
  SupplierInput,
  SupplierPaymentInput
} from '../../src/shared/procurement'
import {
  appendAudit,
  appendSyncOperation,
  recordCashMovement,
  requireChanged,
  withTransaction
} from './primitives'

interface SupplierRow {
  id: string
  name: string
  phone: string
  address: string
  notes: string
  archived: number
  outstanding_minor: number
  created_at: string
  updated_at: string
}

interface PurchaseRow {
  id: string
  purchase_number: string
  supplier_id: string
  supplier_name: string
  supplier_invoice_number: string | null
  status: PurchaseSummary['status']
  additional_costs_minor: number
  total_cost_minor: number
  amount_paid_minor: number
  created_at: string
  received_at: string | null
}

interface ProductForPurchase {
  id: string
  name: string
  sku: string
  unit: Product['unit']
  cost_price_minor: number
  stock_on_hand_milli: number
}

interface PurchaseItemRow {
  product_id: string
  product_name_snapshot: string
  sku_snapshot: string
  unit_snapshot: Product['unit']
  quantity_milli: number
  unit_cost_minor: number
  extended_cost_minor: number
  landed_cost_minor: number
}

interface PaymentRow {
  method: PurchasePayment['method']
  amount_minor: number
  reference: string
  created_at: string
}

interface ExpenseRow {
  id: string
  category_id: string
  category_name: string
  description: string
  amount_minor: number
  method: Expense['method']
  business_date: string
  archived: number
  created_at: string
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    archived: row.archived === 1,
    outstandingMinor: row.outstanding_minor,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapPurchase(row: PurchaseRow): PurchaseSummary {
  return {
    id: row.id,
    purchaseNumber: row.purchase_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierInvoiceNumber: row.supplier_invoice_number,
    status: row.status,
    additionalCostsMinor: row.additional_costs_minor,
    totalCostMinor: row.total_cost_minor,
    amountPaidMinor: row.amount_paid_minor,
    balanceMinor: row.total_cost_minor - row.amount_paid_minor,
    createdAt: row.created_at,
    receivedAt: row.received_at
  }
}

function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    description: row.description,
    amountMinor: row.amount_minor,
    method: row.method,
    businessDate: row.business_date,
    archived: row.archived === 1,
    createdAt: row.created_at
  }
}

export class ProcurementRepository {
  constructor(private readonly database: DatabaseSync) {}

  listSuppliers(search = '', includeArchived = false): Supplier[] {
    const needle = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
    const rows = this.database.prepare(`
      SELECT s.id, s.name, s.phone, s.address, s.notes, s.archived,
        s.created_at, s.updated_at,
        COALESCE((
          SELECT SUM(p.total_cost_minor) FROM purchases p
          WHERE p.supplier_id = s.id AND p.status = 'received'
        ), 0) - COALESCE((
          SELECT SUM(sp.amount_minor) FROM supplier_payments sp
          WHERE sp.supplier_id = s.id
        ), 0) AS outstanding_minor
      FROM suppliers s
      WHERE (? = '' OR s.name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR s.phone LIKE ? ESCAPE '\\' COLLATE NOCASE)
        AND (? = 1 OR s.archived = 0)
      ORDER BY s.name COLLATE NOCASE
      LIMIT 500
    `).all(search.trim(), needle, needle, includeArchived ? 1 : 0) as unknown as SupplierRow[]
    return rows.map(mapSupplier)
  }

  createSupplier(input: SupplierInput): Supplier {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO suppliers (id, name, phone, address, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.phone, input.address, input.notes, timestamp, timestamp)
      appendAudit(this.database, 'supplier.created', 'supplier', id, input)
      appendSyncOperation(this.database, 'supplier', id, 'upsert', { id, ...input })
    })
    const supplier = this.listSuppliers('', true).find((item) => item.id === id)
    if (!supplier) throw new Error('Created supplier could not be loaded')
    return supplier
  }

  updateSupplier(id: string, input: SupplierInput): Supplier {
    withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE suppliers SET name = ?, phone = ?, address = ?, notes = ?, updated_at = ?
        WHERE id = ? AND archived = 0
      `).run(input.name, input.phone, input.address, input.notes, new Date().toISOString(), id)
      requireChanged(result.changes, 'Supplier was not found or is archived')
      appendAudit(this.database, 'supplier.updated', 'supplier', id, input)
      appendSyncOperation(this.database, 'supplier', id, 'upsert', { id, ...input })
    })
    const supplier = this.listSuppliers('', true).find((item) => item.id === id)
    if (!supplier) throw new Error('Updated supplier could not be loaded')
    return supplier
  }

  archiveSupplier(id: string): void {
    this.setSupplierArchived(id, true)
  }

  restoreSupplier(id: string): void {
    this.setSupplierArchived(id, false)
  }

  listPurchases(search = ''): PurchaseSummary[] {
    const needle = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
    const rows = this.database.prepare(`
      SELECT p.id, p.purchase_number, p.supplier_id, s.name AS supplier_name,
        p.supplier_invoice_number, p.status, p.additional_costs_minor,
        p.total_cost_minor, p.amount_paid_minor, p.created_at, p.received_at
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE (? = '' OR p.purchase_number LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR COALESCE(p.supplier_invoice_number, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR s.name LIKE ? ESCAPE '\\' COLLATE NOCASE)
      ORDER BY p.created_at DESC
      LIMIT 500
    `).all(search.trim(), needle, needle, needle) as unknown as PurchaseRow[]
    return rows.map(mapPurchase)
  }

  createPurchaseDraft(input: PurchaseDraftInput): PurchaseDetail {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    const lineCosts = input.items.map((item) => roundMinorProduct(item.unitCostMinor, item.quantityMilli))
    const total = lineCosts.reduce((sum, amount) => sum + BigInt(amount), BigInt(input.additionalCostsMinor))
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Purchase total exceeds the supported financial range')

    withTransaction(this.database, () => {
      this.requireActiveSupplier(input.supplierId)
      this.assertUniqueProducts(input.items.map((item) => item.productId))
      this.database.prepare(`
        INSERT INTO purchases (
          id, purchase_number, supplier_id, supplier_invoice_number,
          additional_costs_minor, total_cost_minor, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        this.nextPurchaseNumber(sriLankaBusinessDate()),
        input.supplierId,
        input.supplierInvoiceNumber || null,
        input.additionalCostsMinor,
        Number(total),
        timestamp,
        timestamp
      )
      this.insertDraftItems(id, input.items, lineCosts)
      appendAudit(this.database, 'purchase.draft_created', 'purchase', id, input)
      appendSyncOperation(this.database, 'purchase', id, 'draft', input)
    })

    const purchase = this.getPurchase(id)
    if (!purchase) throw new Error('Created purchase could not be loaded')
    return purchase
  }

  updatePurchaseDraft(id: string, input: PurchaseDraftInput): PurchaseDetail {
    withTransaction(this.database, () => {
      const purchase = this.database.prepare(`
        SELECT status FROM purchases WHERE id = ?
      `).get(id) as { status: PurchaseSummary['status'] } | undefined
      if (!purchase || purchase.status !== 'draft') {
        throw new Error('Only an existing draft purchase can be edited')
      }
      this.requireActiveSupplier(input.supplierId)
      this.assertUniqueProducts(input.items.map((item) => item.productId))
      const lineCosts = input.items.map((item) => roundMinorProduct(item.unitCostMinor, item.quantityMilli))
      const total = lineCosts.reduce((sum, amount) => sum + BigInt(amount), BigInt(input.additionalCostsMinor))
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Purchase total exceeds the supported financial range')

      this.database.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id)
      this.insertDraftItems(id, input.items, lineCosts)
      this.database.prepare(`
        UPDATE purchases
        SET supplier_id = ?, supplier_invoice_number = ?, additional_costs_minor = ?,
          total_cost_minor = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.supplierId,
        input.supplierInvoiceNumber || null,
        input.additionalCostsMinor,
        Number(total),
        new Date().toISOString(),
        id
      )
      appendAudit(this.database, 'purchase.draft_updated', 'purchase', id, input)
      appendSyncOperation(this.database, 'purchase', id, 'draft', input)
    })

    const purchase = this.getPurchase(id)
    if (!purchase) throw new Error('Updated purchase could not be loaded')
    return purchase
  }

  cancelPurchaseDraft(id: string): void {
    withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE purchases SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status = 'draft'
      `).run(new Date().toISOString(), id)
      requireChanged(result.changes, 'Only a draft purchase can be cancelled')
      appendAudit(this.database, 'purchase.draft_cancelled', 'purchase', id, {})
      appendSyncOperation(this.database, 'purchase', id, 'cancel', { id })
    })
  }

  reopenCancelledPurchase(id: string): PurchaseDetail {
    let purchase: PurchaseDetail | undefined
    withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE purchases SET status = 'draft', updated_at = ?
        WHERE id = ? AND status = 'cancelled' AND amount_paid_minor = 0 AND received_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM supplier_payments WHERE purchase_id = ?)
      `).run(new Date().toISOString(), id, id)
      requireChanged(result.changes, 'Only an unpaid, unreceived cancelled purchase can be reopened')
      purchase = this.getPurchase(id)
      if (!purchase) throw new Error('Reopened purchase could not be loaded')
      appendAudit(this.database, 'purchase.draft_reopened', 'purchase', id, {})
      appendSyncOperation(this.database, 'purchase', id, 'draft', {
        supplierId: purchase.supplierId,
        supplierInvoiceNumber: purchase.supplierInvoiceNumber ?? '',
        additionalCostsMinor: purchase.additionalCostsMinor,
        items: purchase.items.map((item) => ({
          productId: item.productId,
          quantityMilli: item.quantityMilli,
          unitCostMinor: item.unitCostMinor
        }))
      })
    })
    if (!purchase) throw new Error('Reopened purchase could not be loaded')
    return purchase
  }

  receivePurchase(input: ReceivePurchaseInput): PurchaseDetail {
    withTransaction(this.database, () => {
      const purchase = this.database.prepare(`
        SELECT id, supplier_id, purchase_number, additional_costs_minor, status
        FROM purchases WHERE id = ?
      `).get(input.id) as {
        id: string
        supplier_id: string
        purchase_number: string
        additional_costs_minor: number
        status: PurchaseSummary['status']
      } | undefined
      if (!purchase || purchase.status !== 'draft') {
        throw new Error('Only a draft purchase can be received; completed purchases are immutable')
      }

      const rows = this.database.prepare(`
        SELECT product_id, product_name_snapshot, sku_snapshot, unit_snapshot,
          quantity_milli, unit_cost_minor, extended_cost_minor, landed_cost_minor
        FROM purchase_items WHERE purchase_id = ?
      `).all(input.id) as unknown as PurchaseItemRow[]
      if (rows.length === 0) throw new Error('A purchase must contain at least one product')

      const costWeights = rows.map((row) => row.extended_cost_minor)
      const allocationWeights = costWeights.some((cost) => cost > 0)
        ? costWeights
        : rows.map((row) => row.quantity_milli)
      const landedCosts = allocateMinorProportionally(allocationWeights, purchase.additional_costs_minor)
      const goodsCost = rows.reduce((sum, row) => sum + BigInt(row.extended_cost_minor), 0n)
      const totalCost = goodsCost + BigInt(purchase.additional_costs_minor)
      const paid = input.payments.reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n)
      if (paid > totalCost) throw new Error('Purchase payments cannot exceed the received purchase total')
      if (totalCost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Purchase total exceeds the supported financial range')

      const now = new Date().toISOString()
      const updateItem = this.database.prepare(`
        UPDATE purchase_items SET landed_cost_minor = ? WHERE purchase_id = ? AND product_id = ?
      `)
      const insertMovement = this.database.prepare(`
        INSERT INTO stock_movements (
          id, product_id, movement_type, quantity_delta_milli, unit_cost_minor,
          reason, reference_id, created_at
        ) VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?)
      `)
      const updateProduct = this.database.prepare(`
        UPDATE products SET cost_price_minor = ?, updated_at = ? WHERE id = ?
      `)

      rows.forEach((row, index) => {
        const product = this.getProductForPurchase(row.product_id)
        const receivedTotalCost = row.extended_cost_minor + landedCosts[index]
        if (!Number.isSafeInteger(receivedTotalCost)) {
          throw new Error('Landed purchase cost exceeds the supported financial range')
        }
        const averageCost = weightedAverageCostMinor(
          product.stock_on_hand_milli,
          product.cost_price_minor,
          row.quantity_milli,
          receivedTotalCost
        )
        const receivedUnitCostBigInt = (
          BigInt(receivedTotalCost) * 1000n + BigInt(row.quantity_milli) / 2n
        ) / BigInt(row.quantity_milli)
        if (receivedUnitCostBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Received unit cost exceeds the supported financial range')
        }
        const receivedUnitCost = Number(receivedUnitCostBigInt)

        updateItem.run(landedCosts[index], input.id, row.product_id)
        updateProduct.run(averageCost, now, row.product_id)
        insertMovement.run(
          randomUUID(),
          row.product_id,
          row.quantity_milli,
          receivedUnitCost,
          `Purchase ${purchase.purchase_number}`,
          input.id,
          now
        )
      })

      const insertPayment = this.database.prepare(`
        INSERT INTO supplier_payments (
          id, purchase_id, supplier_id, method, amount_minor, reference, created_at, business_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const payment of input.payments) {
        insertPayment.run(
          randomUUID(),
          input.id,
          purchase.supplier_id,
          payment.method,
          payment.amountMinor,
          payment.reference,
          now,
          sriLankaBusinessDate(new Date(now))
        )
        if (payment.method === 'cash') {
          recordCashMovement(
            this.database,
            'out',
            'supplier_payment',
            payment.amountMinor,
            `Purchase ${purchase.purchase_number}`,
            input.id,
            now
          )
        }
      }
      this.database.prepare(`
        UPDATE purchases SET status = 'received', total_cost_minor = ?,
          amount_paid_minor = ?, received_at = ?, received_business_date = ?, updated_at = ?
        WHERE id = ?
      `).run(Number(totalCost), Number(paid), now, sriLankaBusinessDate(new Date(now)), now, input.id)

      appendAudit(this.database, 'purchase.received', 'purchase', input.id, {
        purchaseNumber: purchase.purchase_number,
        totalCostMinor: Number(totalCost),
        amountPaidMinor: Number(paid)
      })
      appendSyncOperation(this.database, 'purchase', input.id, 'receive', {
        purchaseId: input.id,
        payments: input.payments
      })
    })

    const received = this.getPurchase(input.id)
    if (!received) throw new Error('Received purchase could not be loaded')
    return received
  }

  recordSupplierPayment(input: SupplierPaymentInput): PurchaseDetail {
    withTransaction(this.database, () => {
      const purchase = this.database.prepare(`
        SELECT id, supplier_id, total_cost_minor, status FROM purchases WHERE id = ?
      `).get(input.purchaseId) as {
        id: string
        supplier_id: string
        total_cost_minor: number
        status: PurchaseSummary['status']
      } | undefined
      if (!purchase || purchase.status !== 'received') {
        throw new Error('Supplier payments can only be recorded against a received purchase')
      }

      const paid = this.database.prepare(`
        SELECT COALESCE(SUM(amount_minor), 0) AS amount
        FROM supplier_payments WHERE purchase_id = ?
      `).get(input.purchaseId) as { amount: number }
      if (input.amountMinor > purchase.total_cost_minor - paid.amount) {
        throw new Error('Supplier payment cannot exceed the outstanding purchase balance')
      }

      const now = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO supplier_payments (
          id, purchase_id, supplier_id, method, amount_minor, reference, created_at, business_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), input.purchaseId, purchase.supplier_id, input.method,
        input.amountMinor, input.reference, now, sriLankaBusinessDate(new Date(now))
      )
      this.database.prepare(`
        UPDATE purchases SET amount_paid_minor = amount_paid_minor + ?, updated_at = ?
        WHERE id = ?
      `).run(input.amountMinor, now, input.purchaseId)
      if (input.method === 'cash') {
        recordCashMovement(
          this.database,
          'out',
          'supplier_payment',
          input.amountMinor,
          `Supplier payment for ${input.purchaseId}`,
          input.purchaseId,
          now
        )
      }
      appendAudit(this.database, 'supplier_payment.recorded', 'purchase', input.purchaseId, input)
      appendSyncOperation(this.database, 'supplier_payment', input.purchaseId, 'create', input)
    })

    const updated = this.getPurchase(input.purchaseId)
    if (!updated) throw new Error('Purchase after payment could not be loaded')
    return updated
  }

  listExpenseCategories(): ExpenseCategory[] {
    const rows = this.database.prepare(`
      SELECT id, name, archived FROM expense_categories
      WHERE archived = 0 ORDER BY name COLLATE NOCASE
    `).all() as unknown as Array<{ id: string; name: string; archived: number }>
    return rows.map((row) => ({ id: row.id, name: row.name, archived: row.archived === 1 }))
  }

  listExpenses(search = '', fromDate?: string, toDate?: string, includeArchived = false): Expense[] {
    const needle = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
    const rows = this.database.prepare(`
      SELECT e.id, e.category_id, c.name AS category_name, e.description,
        e.amount_minor, e.method, e.business_date, e.archived, e.created_at
      FROM expenses e JOIN expense_categories c ON c.id = e.category_id
      WHERE (? = '' OR e.description LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR c.name LIKE ? ESCAPE '\\' COLLATE NOCASE)
        AND (? IS NULL OR e.business_date >= ?)
        AND (? IS NULL OR e.business_date <= ?)
        AND (? = 1 OR e.archived = 0)
      ORDER BY e.business_date DESC, e.created_at DESC
      LIMIT 1000
    `).all(
      search.trim(), needle, needle, fromDate ?? null, fromDate ?? null,
      toDate ?? null, toDate ?? null, includeArchived ? 1 : 0
    ) as unknown as ExpenseRow[]
    return rows.map(mapExpense)
  }

  createExpense(input: ExpenseInput): Expense {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    withTransaction(this.database, () => {
      this.requireActiveExpenseCategory(input.categoryId)
      this.database.prepare(`
        INSERT INTO expenses (
          id, category_id, description, amount_minor, method, business_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.categoryId, input.description, input.amountMinor, input.method,
        input.businessDate, timestamp, timestamp
      )
      if (input.method === 'cash') {
        recordCashMovement(this.database, 'out', 'expense', input.amountMinor, input.description, id, timestamp)
      }
      appendAudit(this.database, 'expense.created', 'expense', id, input)
      appendSyncOperation(this.database, 'expense', id, 'create', input)
    })
    const expense = this.listExpenses('', undefined, undefined, true).find((item) => item.id === id)
    if (!expense) throw new Error('Created expense could not be loaded')
    return expense
  }

  updateExpense(id: string, input: ExpenseInput): Expense {
    withTransaction(this.database, () => {
      this.requireActiveExpenseCategory(input.categoryId)
      const previous = this.database.prepare(`
        SELECT amount_minor, method FROM expenses WHERE id = ? AND archived = 0
      `).get(id) as { amount_minor: number; method: Expense['method'] } | undefined
      if (!previous) throw new Error('Expense was not found or is archived')
      const oldCashMinor = previous.method === 'cash' ? previous.amount_minor : 0
      const newCashMinor = input.method === 'cash' ? input.amountMinor : 0
      const cashDelta = newCashMinor - oldCashMinor
      if (cashDelta !== 0) {
        recordCashMovement(
          this.database,
          cashDelta > 0 ? 'out' : 'in',
          'manual_adjustment',
          Math.abs(cashDelta),
          `Expense correction: ${input.description}`,
          id
        )
      }
      const result = this.database.prepare(`
        UPDATE expenses SET category_id = ?, description = ?, amount_minor = ?,
          method = ?, business_date = ?, updated_at = ?
        WHERE id = ? AND archived = 0
      `).run(
        input.categoryId, input.description, input.amountMinor, input.method,
        input.businessDate, new Date().toISOString(), id
      )
      requireChanged(result.changes, 'Expense was not found or is archived')
      appendAudit(this.database, 'expense.updated', 'expense', id, input)
      appendSyncOperation(this.database, 'expense', id, 'update', input)
    })
    const expense = this.listExpenses('', undefined, undefined, true).find((item) => item.id === id)
    if (!expense) throw new Error('Updated expense could not be loaded')
    return expense
  }

  archiveExpense(id: string): void {
    withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE expenses SET archived = 1, updated_at = ?
        WHERE id = ? AND archived = 0
      `).run(new Date().toISOString(), id)
      requireChanged(result.changes, 'Expense was not found or is already archived')
      appendAudit(this.database, 'expense.archived', 'expense', id, {})
      appendSyncOperation(this.database, 'expense', id, 'archive', { id })
    })
  }

  restoreExpense(id: string): void {
    withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE expenses SET archived = 0, updated_at = ?
        WHERE id = ? AND archived = 1
      `).run(new Date().toISOString(), id)
      requireChanged(result.changes, 'Archived expense was not found')
      appendAudit(this.database, 'expense.restored', 'expense', id, {})
      appendSyncOperation(this.database, 'expense', id, 'upsert', { id })
    })
  }

  getPurchase(id: string): PurchaseDetail | undefined {
    const row = this.database.prepare(`
      SELECT p.id, p.purchase_number, p.supplier_id, s.name AS supplier_name,
        p.supplier_invoice_number, p.status, p.additional_costs_minor,
        p.total_cost_minor, p.amount_paid_minor, p.created_at, p.received_at
      FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ?
    `).get(id) as PurchaseRow | undefined
    if (!row) return undefined

    const items = this.database.prepare(`
      SELECT product_id, product_name_snapshot, sku_snapshot, unit_snapshot,
        quantity_milli, unit_cost_minor, extended_cost_minor, landed_cost_minor
      FROM purchase_items WHERE purchase_id = ? ORDER BY rowid
    `).all(id) as unknown as PurchaseItemRow[]
    const payments = this.database.prepare(`
      SELECT method, amount_minor, reference, created_at
      FROM supplier_payments WHERE purchase_id = ? ORDER BY created_at, rowid
    `).all(id) as unknown as PaymentRow[]

    return {
      ...mapPurchase(row),
      items: items.map((item): PurchaseItem => ({
        productId: item.product_id,
        productName: item.product_name_snapshot,
        sku: item.sku_snapshot,
        unit: item.unit_snapshot,
        quantityMilli: item.quantity_milli,
        unitCostMinor: item.unit_cost_minor,
        extendedCostMinor: item.extended_cost_minor,
        landedCostMinor: item.landed_cost_minor
      })),
      payments: payments.map((payment): PurchasePayment => ({
        method: payment.method,
        amountMinor: payment.amount_minor,
        reference: payment.reference,
        createdAt: payment.created_at
      }))
    }
  }

  private setSupplierArchived(id: string, archived: boolean): void {
    withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE suppliers SET archived = ?, updated_at = ?
        WHERE id = ? AND archived = ?
      `).run(archived ? 1 : 0, new Date().toISOString(), id, archived ? 1 : 0)
      requireChanged(result.changes, archived
        ? 'Supplier was not found or is already archived'
        : 'Archived supplier was not found')
      appendAudit(this.database, archived ? 'supplier.archived' : 'supplier.restored', 'supplier', id, {})
      appendSyncOperation(this.database, 'supplier', id, archived ? 'archive' : 'upsert', { id })
    })
  }

  private insertDraftItems(
    purchaseId: string,
    items: PurchaseDraftInput['items'],
    lineCosts: number[]
  ): void {
    const insert = this.database.prepare(`
      INSERT INTO purchase_items (
        id, purchase_id, product_id, product_name_snapshot, sku_snapshot, unit_snapshot,
        quantity_milli, unit_cost_minor, extended_cost_minor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    items.forEach((item, index) => {
      const product = this.getProductForPurchase(item.productId)
      insert.run(
        randomUUID(), purchaseId, item.productId, product.name, product.sku, product.unit,
        item.quantityMilli, item.unitCostMinor, lineCosts[index]
      )
    })
  }

  private getProductForPurchase(productId: string): ProductForPurchase {
    const row = this.database.prepare(`
      SELECT p.id, p.name, p.sku, p.unit, p.cost_price_minor,
        COALESCE(SUM(sm.quantity_delta_milli), 0) AS stock_on_hand_milli
      FROM products p
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE p.id = ? AND p.archived = 0
      GROUP BY p.id
    `).get(productId) as ProductForPurchase | undefined
    if (!row) throw new Error('Purchase product was not found or is archived')
    return row
  }

  private requireActiveSupplier(supplierId: string): void {
    const supplier = this.database.prepare(`
      SELECT id FROM suppliers WHERE id = ? AND archived = 0
    `).get(supplierId)
    if (!supplier) throw new Error('Supplier was not found or is archived')
  }

  private requireActiveExpenseCategory(categoryId: string): void {
    const category = this.database.prepare(`
      SELECT id FROM expense_categories WHERE id = ? AND archived = 0
    `).get(categoryId)
    if (!category) throw new Error('Expense category was not found or is archived')
  }

  private assertUniqueProducts(productIds: string[]): void {
    if (new Set(productIds).size !== productIds.length) {
      throw new Error('A product can appear only once in a purchase')
    }
  }

  private nextPurchaseNumber(businessDate: string): string {
    const sequence = this.database.prepare(`
      INSERT INTO purchase_sequences (business_date, last_number) VALUES (?, 1)
      ON CONFLICT(business_date) DO UPDATE SET last_number = last_number + 1
      RETURNING last_number
    `).get(businessDate) as { last_number: number } | undefined
    if (!sequence) throw new Error('Could not allocate a purchase number')
    return `PUR-${businessDate.replace(/-/g, '')}-${String(sequence.last_number).padStart(6, '0')}`
  }
}
