import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from './migrations'

export function openShopDatabase(userDataPath: string): DatabaseSync {
  mkdirSync(userDataPath, { recursive: true })
  const database = new DatabaseSync(join(userDataPath, 'shop.sqlite'))

  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
    `)
    const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`Local database integrity check failed: ${integrity.integrity_check}`)
    }
    migrateDatabase(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
