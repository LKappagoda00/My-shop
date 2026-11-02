import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  formatMinorField,
  formatQuantity,
  parseDecimalToScaled
} from '../src/shared/precision'

describe('exact decimal formatting and parsing', () => {
  it('parses LKR amounts into integer minor currency units', () => {
    expect(parseDecimalToScaled('123.45', 2)).toBe(12345)
    expect(formatMoney(12345)).toBe('LKR 123.45')
    expect(() => parseDecimalToScaled('1.234', 2)).toThrow('Enter a valid number with up to 2 decimal places')
  })

  it('formats purchase payment fields as parseable decimals without thousands separators', () => {
    const paymentAmount = formatMinorField(110000)

    expect(paymentAmount).toBe('1100.00')
    expect(parseDecimalToScaled(paymentAmount, 2)).toBe(110000)
  })

  it('parses fractional stock quantities and preserves their exact display', () => {
    expect(parseDecimalToScaled('1.025', 3)).toBe(1025)
    expect(parseDecimalToScaled('-0.250', 3, true)).toBe(-250)
    expect(formatQuantity(1025)).toBe('1.025')
    expect(formatQuantity(-250)).toBe('-0.25')
  })

  it('rejects decimal values that exceed JavaScript safe integer range', () => {
    expect(() => parseDecimalToScaled('90071992547409.92', 2)).toThrow('Value is too large')
  })
})
