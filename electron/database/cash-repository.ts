import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { sriLankaBusinessDate } from '../../src/shared/business-date'
import type {
  CashMovement,
  CashSession,
  CashStatus,
  ManualCashMovementInput,
  OpenCashSessionInput,
  CloseCashSessionInput
} from '../../src/shared/cash'
import { appendAudit, appendSyncOperation, recordCashMovement, withTransaction } from './primitives'

interface CashSessionRow {
  id: string
  business_date: string
  opening_cash_minor: number
  status: CashSession['status']
  expected_cash_minor: number | null
  actual_cash_minor: number | null
  discrepancy_minor: number | null
  opened_at: string
  closed_at: string | null
}

interface CashMovementRow {
  id: string
  direction: CashMovement['direction']
  movement_type: string
  amount_minor: number
  reason: string
  created_at: string
}

export class CashRepository {
  constructor(private readonly database: DatabaseSync) {}

  getStatus(): CashStatus {
    const todayDate = sriLankaBusinessDate()
    const currentRow = this.database.prepare(`
      SELECT id, business_date, opening_cash_minor, status, expected_cash_minor,
        actual_cash_minor, discrepancy_minor, opened_at, closed_at
      FROM cash_sessions WHERE status = 'open' LIMIT 1
    `).get() as CashSessionRow | undefined
    const todayRow = this.database.prepare(`
      SELECT id, business_date, opening_cash_minor, status, expected_cash_minor,
        actual_cash_minor, discrepancy_minor, opened_at, closed_at
      FROM cash_sessions WHERE business_date = ?
    `).get(todayDate) as CashSessionRow | undefined
    return {
      current: currentRow ? this.mapSession(currentRow) : null,
      today: todayRow ? this.mapSession(todayRow) : null
    }
  }

  openSession(input: OpenCashSessionInput): CashSession {
    const businessDate = sriLankaBusinessDate()
    const id = randomUUID()
    const openedAt = new Date().toISOString()
    withTransaction(this.database, () => {
      const current = this.database.prepare(`
        SELECT id FROM cash_sessions WHERE status = 'open'
      `).get()
      if (current) throw new Error('Close the existing cash session before opening another')
      const today = this.database.prepare(`
        SELECT id FROM cash_sessions WHERE business_date = ?
      `).get(businessDate)
      if (today) throw new Error('A cash session for today has already been closed')

      this.database.prepare(`
        INSERT INTO cash_sessions (id, business_date, opening_cash_minor, opened_at)
        VALUES (?, ?, ?, ?)
      `).run(id, businessDate, input.openingCashMinor, openedAt)
      appendAudit(this.database, 'cash_session.opened', 'cash_session', id, input)
      appendSyncOperation(this.database, 'cash_session', id, 'open', {
        id,
        businessDate,
        ...input,
        openedAt
      })
    })

    const session = this.getSession(id)
    if (!session) throw new Error('Opened cash session could not be loaded')
    return session
  }

  closeSession(input: CloseCashSessionInput): CashSession {
    const sessionId = this.database.prepare(`
      SELECT id FROM cash_sessions WHERE status = 'open'
    `).get() as { id: string } | undefined
    if (!sessionId) throw new Error('There is no open cash session to close')

    withTransaction(this.database, () => {
      const current = this.getSession(sessionId.id)
      if (!current || current.status !== 'open') throw new Error('Cash session is no longer open')
      const expected = BigInt(current.openingCashMinor) + current.movements.reduce((balance, movement) => (
        balance + (movement.direction === 'in' ? BigInt(movement.amountMinor) : -BigInt(movement.amountMinor))
      ), 0n)
      if (expected < 0n || expected > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Expected drawer balance exceeds the supported financial range')
      }
      const expectedCashMinor = Number(expected)
      const discrepancyMinor = input.actualCashMinor - expectedCashMinor
      const closedAt = new Date().toISOString()
      this.database.prepare(`
        UPDATE cash_sessions SET status = 'closed', expected_cash_minor = ?,
          actual_cash_minor = ?, discrepancy_minor = ?, closed_at = ?
        WHERE id = ? AND status = 'open'
      `).run(expectedCashMinor, input.actualCashMinor, discrepancyMinor, closedAt, sessionId.id)
      appendAudit(this.database, 'cash_session.closed', 'cash_session', sessionId.id, {
        expectedCashMinor,
        actualCashMinor: input.actualCashMinor,
        discrepancyMinor
      })
      appendSyncOperation(this.database, 'cash_session', sessionId.id, 'close', {
        expectedCashMinor,
        actualCashMinor: input.actualCashMinor,
        discrepancyMinor,
        closedAt
      })
    })

    const closed = this.getSession(sessionId.id)
    if (!closed) throw new Error('Closed cash session could not be loaded')
    return closed
  }

  recordManualMovement(input: ManualCashMovementInput): CashSession {
    const status = this.getStatus().current
    if (!status) throw new Error('Open a cash session before recording a drawer movement')
    const movementType = input.direction === 'in' ? 'owner_contribution' : 'owner_withdrawal'
    withTransaction(this.database, () => {
      recordCashMovement(
        this.database,
        input.direction,
        movementType,
        input.amountMinor,
        input.reason,
        null
      )
      appendAudit(this.database, `cash.${movementType}`, 'cash_session', status.id, input)
      appendSyncOperation(this.database, 'cash_movement', status.id, movementType, input)
    })
    const updated = this.getSession(status.id)
    if (!updated) throw new Error('Cash movement was recorded but the session could not be loaded')
    return updated
  }

  getSession(id: string): CashSession | undefined {
    const row = this.database.prepare(`
      SELECT id, business_date, opening_cash_minor, status, expected_cash_minor,
        actual_cash_minor, discrepancy_minor, opened_at, closed_at
      FROM cash_sessions WHERE id = ?
    `).get(id) as CashSessionRow | undefined
    return row ? this.mapSession(row) : undefined
  }

  private mapSession(row: CashSessionRow): CashSession {
    const movements = this.database.prepare(`
      SELECT id, direction, movement_type, amount_minor, reason, created_at
      FROM cash_movements WHERE cash_session_id = ? ORDER BY created_at, rowid
    `).all(row.id) as unknown as CashMovementRow[]
    const liveBalance = BigInt(row.opening_cash_minor) + movements.reduce((balance, movement) => (
      balance + (movement.direction === 'in' ? BigInt(movement.amount_minor) : -BigInt(movement.amount_minor))
    ), 0n)
    if (liveBalance < 0n || liveBalance > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Cash drawer balance exceeds the supported financial range')
    }
    return {
      id: row.id,
      businessDate: row.business_date,
      openingCashMinor: row.opening_cash_minor,
      expectedCashMinor: row.expected_cash_minor ?? Number(liveBalance),
      actualCashMinor: row.actual_cash_minor,
      discrepancyMinor: row.discrepancy_minor,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      movements: movements.map((movement) => ({
        id: movement.id,
        direction: movement.direction,
        movementType: movement.movement_type,
        amountMinor: movement.amount_minor,
        reason: movement.reason,
        createdAt: movement.created_at
      }))
    }
  }
}
