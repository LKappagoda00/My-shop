export function roundMinorProduct(unitPriceMinor: number, quantityMilli: number): number {
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0
    || !Number.isSafeInteger(quantityMilli) || quantityMilli < 0) {
    throw new Error('Price and quantity must be non-negative safe integers')
  }
  const result = (BigInt(unitPriceMinor) * BigInt(quantityMilli) + 500n) / 1000n
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Calculated amount exceeds the supported financial range')
  }
  return Number(result)
}

export function allocateMinorProportionally(bases: number[], amount: number): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0
    || bases.some((base) => !Number.isSafeInteger(base) || base < 0)) {
    throw new Error('Allocation values must be non-negative safe integers')
  }

  const totalBase = bases.reduce((sum, base) => sum + BigInt(base), 0n)
  if (amount > 0 && totalBase === 0n) {
    throw new Error('Cannot allocate costs across zero-value lines')
  }
  const allocations = bases.map((base, index) => {
    if (totalBase === 0n) return { index, amount: 0n, remainder: 0n }
    const numerator = BigInt(base) * BigInt(amount)
    return {
      index,
      amount: numerator / totalBase,
      remainder: numerator % totalBase
    }
  })

  let undistributed = BigInt(amount) - allocations.reduce((sum, item) => sum + item.amount, 0n)
  const order = [...allocations].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index
    return left.remainder > right.remainder ? -1 : 1
  })
  for (const item of order) {
    if (undistributed === 0n) break
    item.amount += 1n
    undistributed -= 1n
  }

  return allocations.map((item) => {
    if (item.amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Allocated amount exceeds the supported financial range')
    }
    return Number(item.amount)
  })
}

export function weightedAverageCostMinor(
  existingQuantityMilli: number,
  existingUnitCostMinor: number,
  receivedQuantityMilli: number,
  receivedTotalCostMinor: number
): number {
  for (const value of [
    existingQuantityMilli,
    existingUnitCostMinor,
    receivedQuantityMilli,
    receivedTotalCostMinor
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Weighted-average inputs must be non-negative safe integers')
    }
  }

  const totalQuantity = BigInt(existingQuantityMilli) + BigInt(receivedQuantityMilli)
  if (totalQuantity === 0n) return 0
  const existingValue = BigInt(existingQuantityMilli) * BigInt(existingUnitCostMinor)
  const receivedValue = BigInt(receivedTotalCostMinor) * 1000n
  const average = (existingValue + receivedValue + totalQuantity / 2n) / totalQuantity
  if (average > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Weighted-average cost exceeds the supported financial range')
  }
  return Number(average)
}

export function proportionalMinorShare(totalMinor: number, share: number, whole: number): number {
  if (!Number.isSafeInteger(totalMinor) || !Number.isSafeInteger(share)
    || !Number.isSafeInteger(whole) || totalMinor < 0 || share < 0 || whole <= 0 || share > whole) {
    throw new Error('Invalid proportional amount calculation')
  }
  const amount = (BigInt(totalMinor) * BigInt(share) + BigInt(whole) / 2n) / BigInt(whole)
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Calculated amount exceeds the supported financial range')
  }
  return Number(amount)
}
