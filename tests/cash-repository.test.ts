// @vitest-environment node

import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CashRepository } from '../electron/database/cash-repository'
import { migrateDatabase } from '../electron/database/migrations'
import { recordCashMovement } from '../electron/database/primitives'

describe('cash sessions', () => {
  let database: DatabaseSync
  let cash: CashRepository

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    cash = new CashRepository(database)
  })

  afterEach(() => {
    database.close()
  })

  it('reconciles opening float, cash receipts, payments, and owner movements', () => {
    const opened = cash.openSession({ openingCashMinor: 5000 })
    expect(opened.expectedCashMinor).toBe(5000)
    recordCashMovement(database, 'in', 'sale_receipt', 1200, 'Sale INV-001', 'sale-1')
    recordCashMovement(database, 'out', 'expense', 300, 'Shop supplies', 'expense-1')
    cash.recordManualMovement({ direction: 'in', amountMinor: 1000, reason: 'Owner float' })

    expect(cash.getStatus().current?.expectedCashMinor).toBe(6900)
    const closed = cash.closeSession({ actualCashMinor: 6890 })
    expect(closed.status).toBe('closed')
    expect(closed.expectedCashMinor).toBe(6900)
    expect(closed.discrepancyMinor).toBe(-10)
    expect(cash.getStatus().current).toBeNull()
    expect(cash.getStatus().today?.status).toBe('closed')
  })

  it('rejects cash payments that exceed the drawer and rolls back the transaction', () => {
    cash.openSession({ openingCashMinor: 100 })
    database.exec('BEGIN IMMEDIATE')
    expect(() => recordCashMovement(database, 'out', 'expense', 101, 'Too much', null))
      .toThrow('Cash movement would make the drawer balance negative')
    database.exec('ROLLBACK')
    expect(cash.getStatus().current?.expectedCashMinor).toBe(100)
  })

  it('allows only one open session and does not reopen a closed business date', () => {
    cash.openSession({ openingCashMinor: 0 })
    expect(() => cash.openSession({ openingCashMinor: 0 }))
      .toThrow('Close the existing cash session before opening another')
    cash.closeSession({ actualCashMinor: 0 })
    expect(() => cash.openSession({ openingCashMinor: 100 }))
      .toThrow('A cash session for today has already been closed')
  })
})
