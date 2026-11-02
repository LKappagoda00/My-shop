import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Product } from '../../src/shared/catalog'
import { sriLankaBusinessDate } from '../../src/shared/business-date'
import {
  proportionalMinorShare,
  weightedAverageCostMinor
} from '../../src/shared/financial'
import type {
  SalesReturnDetail,
  SalesReturnInput,
  SalesReturnItem,
  SalesReturnSummary
} from '../../src/shared/returns'
import {
  appendAudit,
  appendSyncOperation,
  recordCashMovement,
  withTransaction
} from './primitives'

interface ReturnRow {
  id: string
  return_number: string
  sale_id: string
  invoice_number: string
  reason: string
  refund_minor: number
  cost_reversal_minor: number
  refund_method: SalesReturnDetail['refundMethod']
  created_at: string
}

interface ReturnItemRow {
  sale_item_id: string
  product_id: string
  product_name_snapshot: string
  unit_snapshot: Product['unit']
  quantity_milli: number
  refund_minor: number
  cost_reversal_minor: number
  restocked: number
}

interface ReturnableSaleItem {
  id: string
  sale_id: string
  product_id: string
  product_name_snapshot: string
  unit_snapshot: Product['unit']
  quantity_milli: number
  net_line_minor: number
  cost_of_goods_minor: number
  returned_quantity_milli: number
  returned_net_minor: number
  returned_resalable_quantity_milli: number
  returned_cost_minor: number
}

interface ReturnProductRow {
  cost_price_minor: number
  stock_on_hand_milli: number
}

function mapReturn(row: ReturnRow): SalesReturnSummary {
  return {
    id: row.id,
    returnNumber: row.return_number,
    saleId: row.sale_id,
    invoiceNumber: row.invoice_number,
    reason: row.reason,
    refundMinor: row.refund_minor,
    costReversalMinor: row.cost_reversal_minor,
    createdAt: row.created_at
  }
}

export class ReturnsRepository {
  constructor(private readonly database: DatabaseSync) {}

  createReturn(input: SalesReturnInput): SalesReturnDetail {
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')

    return withTransaction(this.database, () => {
      const existing = this.database.prepare(`
        SELECT id, request_hash FROM sales_returns WHERE idempotency_key = ?
      `).get(input.idempotencyKey) as { id: string; request_hash: string } | undefined
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new Error('Idempotency key was already used for a different return')
        }
        const detail = this.getReturn(existing.id)
        if (!detail) throw new Error('Previously saved return could not be loaded')
        return detail
      }

      if (new Set(input.lines.map((line) => line.saleItemId)).size !== input.lines.length) {
        throw new Error('A sale line can appear only once in a return')
      }
      const sale = this.database.prepare(`
        SELECT id, status FROM sales WHERE id = ?
      `).get(input.saleId) as { id: string; status: string } | undefined
      if (!sale || sale.status === 'voided') {
        throw new Error('The original sale was not found or cannot be returned')
      }

      const id = randomUUID()
      const now = new Date()
      const createdAt = now.toISOString()
      const returnNumber = this.nextReturnNumber(sriLankaBusinessDate(now))
      const prepared = input.lines.map((line) => {
        const saleItem = this.database.prepare(`
          SELECT id, sale_id, product_id, product_name_snapshot, unit_snapshot,
            quantity_milli, net_line_minor, cost_of_goods_minor, returned_quantity_milli,
            returned_net_minor, returned_resalable_quantity_milli, returned_cost_minor
          FROM sale_items WHERE id = ? AND sale_id = ?
        `).get(line.saleItemId, input.saleId) as ReturnableSaleItem | undefined
        if (!saleItem) throw new Error('A return line does not belong to the selected sale')
        const remaining = saleItem.quantity_milli - saleItem.returned_quantity_milli
        if (line.quantityMilli > remaining) {
          throw new Error(`Return quantity exceeds the remaining eligible quantity for ${saleItem.product_name_snapshot}`)
        }

        const cumulativeQuantity = saleItem.returned_quantity_milli + line.quantityMilli
        const cumulativeRefund = proportionalMinorShare(
          saleItem.net_line_minor,
          cumulativeQuantity,
          saleItem.quantity_milli
        )
        const refundMinor = cumulativeRefund - saleItem.returned_net_minor
        if (refundMinor < 0) throw new Error('Return allocation produced a negative refund')

        const cumulativeResalableQuantity = saleItem.returned_resalable_quantity_milli
          + (line.restock ? line.quantityMilli : 0)
        const cumulativeCost = proportionalMinorShare(
          saleItem.cost_of_goods_minor,
          cumulativeResalableQuantity,
          saleItem.quantity_milli
        )
        const costReversalMinor = cumulativeCost - saleItem.returned_cost_minor
        return {
          input: line,
          saleItem,
          cumulativeQuantity,
          cumulativeRefund,
          cumulativeResalableQuantity,
          cumulativeCost,
          refundMinor,
          costReversalMinor
        }
      })

      const refundTotal = prepared.reduce((sum, line) => sum + BigInt(line.refundMinor), 0n)
      const costReversalTotal = prepared.reduce((sum, line) => sum + BigInt(line.costReversalMinor), 0n)
      if (refundTotal > BigInt(Number.MAX_SAFE_INTEGER) || costReversalTotal > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Return total exceeds the supported financial range')
      }
      const refundMinor = Number(refundTotal)
      const costReversalMinor = Number(costReversalTotal)

      this.database.prepare(`
        INSERT INTO sales_returns (
          id, return_number, sale_id, idempotency_key, request_hash, reason,
          refund_minor, cost_reversal_minor, refund_method, created_at, business_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, returnNumber, input.saleId, input.idempotencyKey, requestHash, input.reason,
        refundMinor, costReversalMinor, input.refundMethod, createdAt, sriLankaBusinessDate(now)
      )

      const insertReturnItem = this.database.prepare(`
        INSERT INTO sales_return_items (
          id, return_id, sale_item_id, product_id, product_name_snapshot,
          unit_snapshot, quantity_milli, refund_minor, cost_reversal_minor, restocked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const updateSaleItem = this.database.prepare(`
        UPDATE sale_items SET returned_quantity_milli = ?, returned_net_minor = ?,
          returned_resalable_quantity_milli = ?, returned_cost_minor = ?
        WHERE id = ?
      `)
      const insertMovement = this.database.prepare(`
        INSERT INTO stock_movements (
          id, product_id, movement_type, quantity_delta_milli, unit_cost_minor,
          reason, reference_id, created_at
        ) VALUES (?, ?, 'return', ?, ?, ?, ?, ?)
      `)
      const updateCost = this.database.prepare(`
        UPDATE products SET cost_price_minor = ?, updated_at = ? WHERE id = ?
      `)

      for (const line of prepared) {
        insertReturnItem.run(
          randomUUID(), id, line.saleItem.id, line.saleItem.product_id,
          line.saleItem.product_name_snapshot, line.saleItem.unit_snapshot,
          line.input.quantityMilli, line.refundMinor, line.costReversalMinor,
          line.input.restock ? 1 : 0
        )
        updateSaleItem.run(
          line.cumulativeQuantity,
          line.cumulativeRefund,
          line.cumulativeResalableQuantity,
          line.cumulativeCost,
          line.saleItem.id
        )

        if (line.input.restock) {
          const product = this.getReturnProduct(line.saleItem.product_id)
          const averageCost = weightedAverageCostMinor(
            product.stock_on_hand_milli,
            product.cost_price_minor,
            line.input.quantityMilli,
            line.costReversalMinor
          )
          const unitCost = (
            BigInt(line.costReversalMinor) * 1000n + BigInt(line.input.quantityMilli) / 2n
          ) / BigInt(line.input.quantityMilli)
          if (unitCost > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error('Returned item cost exceeds the supported financial range')
          }
          updateCost.run(averageCost, createdAt, line.saleItem.product_id)
          insertMovement.run(
            randomUUID(),
            line.saleItem.product_id,
            line.input.quantityMilli,
            Number(unitCost),
            `Return ${returnNumber}: ${input.reason}`,
            id,
            createdAt
          )
        }
      }

      if (refundMinor > 0) {
        this.database.prepare(`
          INSERT INTO return_payments (id, return_id, method, amount_minor, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(randomUUID(), id, input.refundMethod, refundMinor, createdAt)
        if (input.refundMethod === 'cash') {
          recordCashMovement(
            this.database,
            'out',
            'sale_refund',
            refundMinor,
            `Return ${returnNumber}`,
            id,
            createdAt
          )
        }
      }

      const remaining = this.database.prepare(`
        SELECT COUNT(*) AS remaining
        FROM sale_items WHERE sale_id = ? AND returned_quantity_milli < quantity_milli
      `).get(input.saleId) as { remaining: number }
      const nextStatus = remaining.remaining === 0 ? 'returned' : 'partially_returned'
      this.database.prepare('UPDATE sales SET status = ? WHERE id = ?').run(nextStatus, input.saleId)

      appendAudit(this.database, 'sale.returned', 'sale', input.saleId, {
        returnId: id,
        returnNumber,
        refundMinor,
        costReversalMinor,
        reason: input.reason
      })
      appendSyncOperation(this.database, 'sales_return', id, 'create', {
        id,
        input,
        refundMinor,
        costReversalMinor
      })

      const detail = this.getReturn(id)
      if (!detail) throw new Error('Saved return could not be loaded')
      return detail
    })
  }

  listReturns(search = ''): SalesReturnSummary[] {
    const needle = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
    const rows = this.database.prepare(`
      SELECT r.id, r.return_number, r.sale_id, s.invoice_number, r.reason,
        r.refund_minor, r.cost_reversal_minor, r.refund_method, r.created_at
      FROM sales_returns r JOIN sales s ON s.id = r.sale_id
      WHERE (? = '' OR r.return_number LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR s.invoice_number LIKE ? ESCAPE '\\' COLLATE NOCASE)
      ORDER BY r.created_at DESC
      LIMIT 500
    `).all(search.trim(), needle, needle) as unknown as ReturnRow[]
    return rows.map(mapReturn)
  }

  getReturn(id: string): SalesReturnDetail | undefined {
    const row = this.database.prepare(`
      SELECT r.id, r.return_number, r.sale_id, s.invoice_number, r.reason,
        r.refund_minor, r.cost_reversal_minor, r.refund_method, r.created_at
      FROM sales_returns r JOIN sales s ON s.id = r.sale_id
      WHERE r.id = ?
    `).get(id) as ReturnRow | undefined
    if (!row) return undefined

    const items = this.database.prepare(`
      SELECT sale_item_id, product_id, product_name_snapshot, unit_snapshot,
        quantity_milli, refund_minor, cost_reversal_minor, restocked
      FROM sales_return_items WHERE return_id = ? ORDER BY rowid
    `).all(id) as unknown as ReturnItemRow[]
    return {
      ...mapReturn(row),
      refundMethod: row.refund_method,
      items: items.map((item): SalesReturnItem => ({
        saleItemId: item.sale_item_id,
        productId: item.product_id,
        productName: item.product_name_snapshot,
        unit: item.unit_snapshot,
        quantityMilli: item.quantity_milli,
        refundMinor: item.refund_minor,
        costReversalMinor: item.cost_reversal_minor,
        restocked: item.restocked === 1
      }))
    }
  }

  private getReturnProduct(productId: string): ReturnProductRow {
    const row = this.database.prepare(`
      SELECT p.cost_price_minor,
        COALESCE(SUM(sm.quantity_delta_milli), 0) AS stock_on_hand_milli
      FROM products p
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE p.id = ?
      GROUP BY p.id
    `).get(productId) as ReturnProductRow | undefined
    if (!row) throw new Error('Returned product no longer exists')
    return row
  }

  private nextReturnNumber(businessDate: string): string {
    const sequence = this.database.prepare(`
      INSERT INTO return_sequences (business_date, last_number) VALUES (?, 1)
      ON CONFLICT(business_date) DO UPDATE SET last_number = last_number + 1
      RETURNING last_number
    `).get(businessDate) as { last_number: number } | undefined
    if (!sequence) throw new Error('Could not allocate a return number')
    return `RET-${businessDate.replace(/-/g, '')}-${String(sequence.last_number).padStart(6, '0')}`
  }
}
