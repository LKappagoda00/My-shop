import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export function withTransaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function appendAudit(
  database: DatabaseSync,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown
): void {
  database.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, entity_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), action, entityType, entityId, JSON.stringify(details), new Date().toISOString())
}

export function appendSyncOperation(
  database: DatabaseSync,
  entityType: string,
  entityId: string,
  operation: string,
  payload: unknown
): void {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  database.prepare(`
    INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, payload_json, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, entityType, entityId, operation, JSON.stringify(payload), id, timestamp, timestamp)
}

export function requireChanged(changes: number | bigint, message: string): void {
  if (changes === 0 || changes === 0n) throw new Error(message)
}

export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ERR_SQLITE_CONSTRAINT_UNIQUE'
}

export function recordCashMovement(
  database: DatabaseSync,
  direction: 'in' | 'out',
  movementType: string,
  amountMinor: number,
  reason: string,
  referenceId: string | null,
  timestamp = new Date().toISOString()
): void {
  if (amountMinor === 0) return
  const session = database.prepare(`
    SELECT id, opening_cash_minor FROM cash_sessions WHERE status = 'open'
  `).get() as { id: string; opening_cash_minor: number } | undefined
  if (!session) throw new Error('Open a cash session before recording cash payments')
  const movements = database.prepare(`
    SELECT direction, amount_minor FROM cash_movements WHERE cash_session_id = ?
  `).all(session.id) as unknown as Array<{ direction: 'in' | 'out'; amount_minor: number }>
  const balance = BigInt(session.opening_cash_minor) + movements.reduce((total, movement) => (
    total + (movement.direction === 'in' ? BigInt(movement.amount_minor) : -BigInt(movement.amount_minor))
  ), 0n)
  const nextBalance = balance + (direction === 'in' ? BigInt(amountMinor) : -BigInt(amountMinor))
  if (nextBalance < 0n) throw new Error('Cash movement would make the drawer balance negative')
  if (nextBalance > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Cash drawer balance exceeds the supported financial range')
  }
  database.prepare(`
    INSERT INTO cash_movements (
      id, cash_session_id, direction, movement_type, amount_minor, reason, reference_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), session.id, direction, movementType, amountMinor, reason, referenceId, timestamp)
}
