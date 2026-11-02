const wholeLkr = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 })

export function parseDecimalToScaled(
  input: string,
  decimalPlaces: number,
  allowNegative = false
): number {
  const expression = allowNegative
    ? new RegExp(`^-?\\d+(?:\\.\\d{1,${decimalPlaces}})?$`)
    : new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`)
  const value = input.trim()
  if (!expression.test(value)) {
    throw new Error(`Enter a valid number with up to ${decimalPlaces} decimal places`)
  }

  const negative = value.startsWith('-')
  const absolute = negative ? value.slice(1) : value
  const [whole, fraction = ''] = absolute.split('.')
  const scale = 10n ** BigInt(decimalPlaces)
  const scaled = BigInt(whole) * scale
    + BigInt(fraction.padEnd(decimalPlaces, '0') || '0')
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Value is too large')
  return Number(negative ? -scaled : scaled)
}

export function formatMoney(minor: number): string {
  const whole = Math.floor(minor / 100)
  const fraction = String(minor % 100).padStart(2, '0')
  return `LKR ${wholeLkr.format(whole)}.${fraction}`
}

export function formatMinorField(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}

export function formatMilliField(milli: number): string {
  const absolute = Math.abs(milli)
  const value = `${Math.floor(absolute / 1000)}.${String(absolute % 1000).padStart(3, '0')}`
  return milli < 0 ? `-${value}` : value
}

export function formatQuantity(milli: number): string {
  const absolute = Math.abs(milli)
  const whole = wholeLkr.format(Math.floor(absolute / 1000))
  const fraction = String(absolute % 1000).padStart(3, '0').replace(/0+$/, '')
  const value = fraction ? `${whole}.${fraction}` : whole
  return milli < 0 ? `-${value}` : value
}
