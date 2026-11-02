import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  heldSaleInputSchema,
  type HeldSale,
  type HeldSaleInput
} from '../../src/shared/sales'
import { appendAudit, requireChanged, withTransaction } from './primitives'

interface HeldSaleRow {
  id: string
  title: string
  payload_json: string
  updated_at: string
}

function mapHeldSale(row: HeldSaleRow): HeldSale {
  let payload: unknown
  try {
    payload = JSON.parse(row.payload_json)
  } catch (error) {
    throw new Error(`Held sale ${row.id} contains invalid saved data`, { cause: error })
  }
  const parsed = heldSaleInputSchema.safeParse(payload)
  if (!parsed.success) throw new Error(`Held sale ${row.id} failed saved-data validation`)
  return { ...parsed.data, updatedAt: row.updated_at }
}

export class HeldSalesRepository {
  constructor(private readonly database: DatabaseSync) {}

  listHeldSales(): HeldSale[] {
    const rows = this.database.prepare(`
      SELECT id, title, payload_json, updated_at
      FROM held_sales ORDER BY updated_at DESC
    `).all() as unknown as HeldSaleRow[]
    return rows.map(mapHeldSale)
  }

  saveHeldSale(input: HeldSaleInput): HeldSale {
    const timestamp = new Date().toISOString()
    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO held_sales (id, title, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `).run(input.id, input.title, JSON.stringify(input), timestamp, timestamp)
      appendAudit(this.database, 'sale.held', 'held_sale', input.id, {
        title: input.title,
        lineCount: input.lines.length
      })
    })
    const heldSale = this.listHeldSales().find((item) => item.id === input.id)
    if (!heldSale) throw new Error('Saved held sale could not be loaded')
    return heldSale
  }

  deleteHeldSale(id: string): void {
    withTransaction(this.database, () => {
      const result = this.database.prepare('DELETE FROM held_sales WHERE id = ?').run(id)
      requireChanged(result.changes, 'Held sale was not found')
      appendAudit(this.database, 'sale.unheld', 'held_sale', id, {})
    })
  }
}
