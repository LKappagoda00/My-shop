import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/shared/csv'

describe('parseCsv', () => {
  it('handles a BOM, quoted commas, escaped quotes, and embedded newlines', () => {
    expect(parseCsv('\uFEFFname,description\r\nTea,"Loose, black"\r\n"Sweet ""Tea""","line one\nline two"\r\n')).toEqual([
      ['name', 'description'],
      ['Tea', 'Loose, black'],
      ['Sweet "Tea"', 'line one\nline two']
    ])
  })

  it('rejects unterminated quoted fields', () => {
    expect(() => parseCsv('name,description\nTea,"broken')).toThrow('CSV contains an unterminated quoted field')
  })
})
