import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Product } from '../../src/shared/catalog'
import { sriLankaBusinessDate } from '../../src/shared/business-date'
import {
  calculateSaleTotals,
  type SaleDetail,
  type SaleInput,
  type SaleItemSnapshot,
  type SalePayment,
  type SaleSummary,
  type SaleVoidInput
} from '../../src/shared/sales'
import {
  appendAudit,
  appendSyncOperation,
  recordCashMovement,
  withTransaction
} from './primitives'

interface ProductForSale extends Product {
  unitCostMinor: number
}

interface SaleRow {
  id: string
  invoice_number: string
  business_date: string
  status: SaleSummary['status']
  gross_sales_minor: number
  line_discounts_minor: number
  bill_discount_minor: number
  net_sales_minor: number
  cost_of_goods_minor: number
  created_at: string
  void_reason?: string | null
  voided_at?: string | null
}

interface SaleItemRow {
  id: string
  product_id: string
  product_name_snapshot: string
  sku_snapshot: string
  unit_snapshot: Product['unit']
  quantity_milli: number
  unit_price_minor: number
  unit_cost_minor: number
  gross_line_minor: number
  line_discount_minor: number
  allocated_bill_discount_minor: number
  net_line_minor: number
  cost_of_goods_minor: number
  returned_quantity_milli: number
  returned_net_minor: number
  returned_resalable_quantity_milli: number
  returned_cost_minor: number
}

interface SalePaymentRow {
  method: SalePayment['method']
  amount_minor: number
  amount_received_minor: number
  change_minor: number
}

interface VoidPaymentRow {
  method: SalePayment['method']
  amount_minor: number
}

function mapSummary(row: SaleRow): SaleSummary {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    businessDate: row.business_date,
    status: row.status,
    grossSalesMinor: row.gross_sales_minor,
    lineDiscountsMinor: row.line_discounts_minor,
    billDiscountMinor: row.bill_discount_minor,
    netSalesMinor: row.net_sales_minor,
    costOfGoodsMinor: row.cost_of_goods_minor,
    createdAt: row.created_at
  }
}

export class SalesRepository {
  constructor(private readonly database: DatabaseSync) {}

  createSale(input: SaleInput): SaleDetail {
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')

    return withTransaction(this.database, () => {
      const existing = this.database.prepare(`
        SELECT id, request_hash FROM sales WHERE idempotency_key = ?
      `).get(input.idempotencyKey) as { id: string; request_hash: string } | undefined
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new Error('Idempotency key was already used for a different checkout')
        }
        const sale = this.getSale(existing.id)
        if (!sale) throw new Error('Previously saved sale could not be loaded')
        return sale
      }

      const productIds = input.lines.map((line) => line.productId)
      if (new Set(productIds).size !== productIds.length) {
        throw new Error('A product can appear only once in the checkout cart')
      }

      const products = input.lines.map((line) => this.getProductForSale(line.productId))
      const totals = calculateSaleTotals(products, input.lines, input.billDiscountMinor)
      this.validatePayments(input, totals.netSalesMinor)

      for (const line of totals.lines) {
        if (line.product.stockOnHandMilli < line.quantityMilli) {
          throw new Error(`Not enough stock for ${line.product.name}`)
        }
      }

      const id = randomUUID()
      const now = new Date()
      const createdAt = now.toISOString()
      const businessDate = sriLankaBusinessDate(now)
      const invoiceNumber = this.nextInvoiceNumber(businessDate)

      this.database.prepare(`
        INSERT INTO sales (
          id, invoice_number, idempotency_key, request_hash, business_date,
          gross_sales_minor, line_discounts_minor, bill_discount_minor,
          net_sales_minor, cost_of_goods_minor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, invoiceNumber, input.idempotencyKey, requestHash, businessDate,
        totals.grossSalesMinor, totals.lineDiscountsMinor, totals.billDiscountMinor,
        totals.netSalesMinor, totals.costOfGoodsMinor, createdAt
      )

      const insertItem = this.database.prepare(`
        INSERT INTO sale_items (
          id, sale_id, product_id, product_name_snapshot, sku_snapshot, unit_snapshot,
          quantity_milli, unit_price_minor, unit_cost_minor, gross_line_minor,
          line_discount_minor, allocated_bill_discount_minor, net_line_minor, cost_of_goods_minor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertMovement = this.database.prepare(`
        INSERT INTO stock_movements (
          id, product_id, movement_type, quantity_delta_milli, unit_cost_minor,
          reason, reference_id, created_at
        ) VALUES (?, ?, 'sale', ?, ?, ?, ?, ?)
      `)

      for (const line of totals.lines) {
        insertItem.run(
          randomUUID(), id, line.product.id, line.product.name, line.product.sku, line.product.unit,
          line.quantityMilli, line.product.sellingPriceMinor, line.product.costPriceMinor,
          line.grossLineMinor, line.lineDiscountMinor, line.allocatedBillDiscountMinor,
          line.netLineMinor, line.costOfGoodsMinor
        )
        insertMovement.run(
          randomUUID(), line.product.id, -line.quantityMilli, line.product.costPriceMinor,
          `Sale ${invoiceNumber}`, id, createdAt
        )
      }

      const insertPayment = this.database.prepare(`
        INSERT INTO sale_payments (
          id, sale_id, method, amount_minor, amount_received_minor, change_minor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const payment of input.payments) {
        const received = payment.amountReceivedMinor ?? payment.amountMinor
        insertPayment.run(
          randomUUID(), id, payment.method, payment.amountMinor, received,
          payment.method === 'cash' ? received - payment.amountMinor : 0,
          createdAt
        )
        if (payment.method === 'cash') {
          recordCashMovement(
            this.database,
            'in',
            'sale_receipt',
            payment.amountMinor,
            `Sale ${invoiceNumber}`,
            id,
            createdAt
          )
        }
      }

      appendAudit(this.database, 'sale.completed', 'sale', id, {
        invoiceNumber,
        netSalesMinor: totals.netSalesMinor,
        costOfGoodsMinor: totals.costOfGoodsMinor
      })
      appendSyncOperation(this.database, 'sale', id, 'create', {
        id,
        invoiceNumber,
        input,
        totals
      })

      if (input.heldSaleId) {
        const deletion = this.database.prepare('DELETE FROM held_sales WHERE id = ?').run(input.heldSaleId)
        if (deletion.changes !== 1) throw new Error('Held sale was not found; checkout was cancelled')
        appendAudit(this.database, 'sale.unheld', 'held_sale', input.heldSaleId, { saleId: id })
      }

      const sale = this.getSale(id)
      if (!sale) throw new Error('Completed sale could not be loaded')
      return sale
    })
  }

  voidSale(input: SaleVoidInput): SaleDetail {
    return withTransaction(this.database, () => {
      const sale = this.database.prepare(`
        SELECT id, invoice_number, status FROM sales WHERE id = ?
      `).get(input.id) as { id: string; invoice_number: string; status: SaleSummary['status'] } | undefined
      if (!sale) throw new Error('Sale was not found')
      if (sale.status !== 'completed') throw new Error('Only completed, unreturned sales can be voided')

      const existingReturn = this.database.prepare(`
        SELECT 1 AS found FROM sales_returns WHERE sale_id = ? LIMIT 1
      `).get(input.id)
      if (existingReturn) throw new Error('A sale with returns cannot be voided')

      const payments = this.database.prepare(`
        SELECT method, amount_minor FROM sale_payments WHERE sale_id = ?
      `).all(input.id) as unknown as VoidPaymentRow[]
      const cashRefund = payments
        .filter((payment) => payment.method === 'cash')
        .reduce((total, payment) => total + BigInt(payment.amount_minor), 0n)
      if (cashRefund > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Cash refund exceeds the supported financial range')
      }

      const timestamp = new Date().toISOString()
      const items = this.database.prepare(`
        SELECT product_id, product_name_snapshot, quantity_milli, unit_cost_minor
        FROM sale_items WHERE sale_id = ?
      `).all(input.id) as unknown as Array<{
        product_id: string
        product_name_snapshot: string
        quantity_milli: number
        unit_cost_minor: number
      }>
      const insertMovement = this.database.prepare(`
        INSERT INTO stock_movements (
          id, product_id, movement_type, quantity_delta_milli, unit_cost_minor,
          reason, reference_id, created_at
        ) VALUES (?, ?, 'return', ?, ?, ?, ?, ?)
      `)
      for (const item of items) {
        insertMovement.run(
          randomUUID(), item.product_id, item.quantity_milli, item.unit_cost_minor,
          `Voided sale ${sale.invoice_number}: ${item.product_name_snapshot}`, input.id, timestamp
        )
      }

      this.database.prepare(`
        UPDATE sales SET status = 'voided', void_reason = ?, voided_at = ? WHERE id = ?
      `).run(input.reason, timestamp, input.id)
      if (cashRefund > 0n) {
        recordCashMovement(
          this.database, 'out', 'sale_refund', Number(cashRefund),
          `Voided sale ${sale.invoice_number}`, input.id, timestamp
        )
      }
      const insertVoidPayment = this.database.prepare(`
        INSERT INTO sale_void_payments (id, sale_id, method, amount_minor, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const payment of payments) {
        insertVoidPayment.run(randomUUID(), input.id, payment.method, payment.amount_minor, timestamp)
      }

      appendAudit(this.database, 'sale.voided', 'sale', input.id, {
        invoiceNumber: sale.invoice_number,
        reason: input.reason,
        cashRefundMinor: Number(cashRefund)
      })
      appendSyncOperation(this.database, 'sale', input.id, 'void', {
        invoiceNumber: sale.invoice_number,
        reason: input.reason
      })

      const detail = this.getSale(input.id)
      if (!detail) throw new Error('Voided sale could not be loaded')
      return detail
    })
  }

  listSales(search = '', businessDate?: string): SaleSummary[] {
    const needle = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
    const rows = this.database.prepare(`
      SELECT id, invoice_number, business_date, status, gross_sales_minor,
        line_discounts_minor, bill_discount_minor, net_sales_minor,
        cost_of_goods_minor, created_at
      FROM sales
      WHERE (? = '' OR invoice_number LIKE ? ESCAPE '\\' COLLATE NOCASE)
        AND (? IS NULL OR business_date = ?)
      ORDER BY created_at DESC
      LIMIT 500
    `).all(search.trim(), needle, businessDate ?? null, businessDate ?? null) as unknown as SaleRow[]
    return rows.map(mapSummary)
  }

  getSale(id: string): SaleDetail | undefined {
    const row = this.database.prepare(`
      SELECT id, invoice_number, business_date, status, gross_sales_minor,
        line_discounts_minor, bill_discount_minor, net_sales_minor,
        cost_of_goods_minor, created_at, void_reason, voided_at
      FROM sales WHERE id = ?
    `).get(id) as SaleRow | undefined
    if (!row) return undefined

    const items = this.database.prepare(`
      SELECT id, product_id, product_name_snapshot, sku_snapshot, unit_snapshot, quantity_milli,
        unit_price_minor, unit_cost_minor, gross_line_minor, line_discount_minor,
        allocated_bill_discount_minor, net_line_minor, cost_of_goods_minor,
        returned_quantity_milli, returned_net_minor, returned_resalable_quantity_milli,
        returned_cost_minor
      FROM sale_items WHERE sale_id = ? ORDER BY rowid
    `).all(id) as unknown as SaleItemRow[]
    const payments = this.database.prepare(`
      SELECT method, amount_minor, amount_received_minor, change_minor
      FROM sale_payments WHERE sale_id = ? ORDER BY rowid
    `).all(id) as unknown as SalePaymentRow[]
    const voidPayments = this.database.prepare(`
      SELECT method, amount_minor FROM sale_void_payments WHERE sale_id = ? ORDER BY rowid
    `).all(id) as unknown as VoidPaymentRow[]

    return {
      ...mapSummary(row),
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name_snapshot,
        sku: item.sku_snapshot,
        unit: item.unit_snapshot,
        quantityMilli: item.quantity_milli,
        unitPriceMinor: item.unit_price_minor,
        unitCostMinor: item.unit_cost_minor,
        grossLineMinor: item.gross_line_minor,
        lineDiscountMinor: item.line_discount_minor,
        allocatedBillDiscountMinor: item.allocated_bill_discount_minor,
        netLineMinor: item.net_line_minor,
        costOfGoodsMinor: item.cost_of_goods_minor,
        returnedQuantityMilli: item.returned_quantity_milli,
        returnableQuantityMilli: item.quantity_milli - item.returned_quantity_milli,
        returnedNetMinor: item.returned_net_minor
      })),
      payments: payments.map((payment) => ({
        method: payment.method,
        amountMinor: payment.amount_minor,
        amountReceivedMinor: payment.amount_received_minor,
        changeMinor: payment.change_minor
      })),
      voidReason: row.void_reason ?? null,
      voidedAt: row.voided_at ?? null,
      voidPayments: voidPayments.map((payment) => ({
        method: payment.method,
        amountMinor: payment.amount_minor,
        amountReceivedMinor: payment.amount_minor,
        changeMinor: 0
      }))
    }
  }

  private getProductForSale(productId: string): ProductForSale {
    const row = this.database.prepare(`
      SELECT p.id, p.name, p.sku, p.barcode, p.category_id,
        c.name AS category_name, p.unit, p.cost_price_minor,
        p.selling_price_minor, p.minimum_stock_milli,
        COALESCE(SUM(sm.quantity_delta_milli), 0) AS stock_on_hand_milli,
        p.archived, p.created_at, p.updated_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE p.id = ? AND p.archived = 0
      GROUP BY p.id
    `).get(productId) as {
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
    } | undefined

    if (!row) throw new Error('Product was not found or is archived')
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      categoryId: row.category_id,
      categoryName: row.category_name,
      unit: row.unit,
      costPriceMinor: row.cost_price_minor,
      unitCostMinor: row.cost_price_minor,
      sellingPriceMinor: row.selling_price_minor,
      minimumStockMilli: row.minimum_stock_milli,
      stockOnHandMilli: row.stock_on_hand_milli,
      archived: row.archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private validatePayments(input: SaleInput, amountDue: number): void {
    const appliedTotal = input.payments.reduce((total, payment) => total + BigInt(payment.amountMinor), 0n)
    if (appliedTotal !== BigInt(amountDue)) {
      throw new Error('Payments must exactly cover the sale total; partial payments are not enabled')
    }

    for (const payment of input.payments) {
      const received = payment.amountReceivedMinor ?? payment.amountMinor
      if (payment.method === 'cash' && received < payment.amountMinor) {
        throw new Error('Cash received cannot be less than the amount due')
      }
      if (payment.method !== 'cash' && received !== payment.amountMinor) {
        throw new Error('Non-cash payment received amount must equal the amount applied')
      }
    }
  }

  private nextInvoiceNumber(businessDate: string): string {
    const sequence = this.database.prepare(`
      INSERT INTO invoice_sequences (business_date, last_number)
      VALUES (?, 1)
      ON CONFLICT(business_date) DO UPDATE SET last_number = last_number + 1
      RETURNING last_number
    `).get(businessDate) as { last_number: number } | undefined
    if (!sequence) throw new Error('Could not allocate an invoice number')
    return `INV-${businessDate.replace(/-/g, '')}-${String(sequence.last_number).padStart(6, '0')}`
  }
}
