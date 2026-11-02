import { z } from 'zod'
import type { Product } from './catalog'
import { allocateMinorProportionally, roundMinorProduct } from './financial'

const nonNegativeMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveMilli = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

export const paymentMethods = ['cash', 'card', 'bank_transfer', 'qr'] as const
export const saleCartLineSchema = z.object({
  productId: z.string().uuid(),
  quantityMilli: positiveMilli,
  lineDiscountMinor: nonNegativeMinor.default(0)
})

export const saleInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  heldSaleId: z.string().uuid().optional(),
  billDiscountMinor: nonNegativeMinor,
  lines: z.array(saleCartLineSchema).min(1).max(500),
  payments: z.array(z.object({
    method: z.enum(paymentMethods),
    amountMinor: positiveMilli,
    amountReceivedMinor: nonNegativeMinor.optional()
  })).min(1).max(4)
})

export const heldSaleInputSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
  billDiscountMinor: nonNegativeMinor,
  lines: z.array(saleCartLineSchema).min(1).max(500)
})

export type SaleInput = z.infer<typeof saleInputSchema>
export type HeldSaleInput = z.infer<typeof heldSaleInputSchema>
export type PaymentMethod = (typeof paymentMethods)[number]

export interface HeldSale extends HeldSaleInput {
  updatedAt: string
}

export interface CalculatedSaleLine {
  product: Product
  quantityMilli: number
  grossLineMinor: number
  lineDiscountMinor: number
  allocatedBillDiscountMinor: number
  netLineMinor: number
  costOfGoodsMinor: number
}

export interface SaleTotals {
  lines: CalculatedSaleLine[]
  grossSalesMinor: number
  lineDiscountsMinor: number
  billDiscountMinor: number
  netSalesMinor: number
  costOfGoodsMinor: number
}

export interface SaleSummary {
  id: string
  invoiceNumber: string
  businessDate: string
  status: 'completed' | 'voided' | 'partially_returned' | 'returned'
  grossSalesMinor: number
  lineDiscountsMinor: number
  billDiscountMinor: number
  netSalesMinor: number
  costOfGoodsMinor: number
  createdAt: string
}

export interface SaleItemSnapshot {
  id: string
  productId: string
  productName: string
  sku: string
  unit: Product['unit']
  quantityMilli: number
  unitPriceMinor: number
  unitCostMinor: number
  grossLineMinor: number
  lineDiscountMinor: number
  allocatedBillDiscountMinor: number
  netLineMinor: number
  costOfGoodsMinor: number
  returnedQuantityMilli: number
  returnableQuantityMilli: number
  returnedNetMinor: number
}

export interface SalePayment {
  method: PaymentMethod
  amountMinor: number
  amountReceivedMinor: number
  changeMinor: number
}

export interface SaleDetail extends SaleSummary {
  items: SaleItemSnapshot[]
  payments: SalePayment[]
  voidReason: string | null
  voidedAt: string | null
  voidPayments: SalePayment[]
}

export const saleVoidSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(300)
})
export type SaleVoidInput = z.infer<typeof saleVoidSchema>

function safeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the supported financial range`)
  }
  return Number(value)
}

export function calculateSaleTotals(
  products: Product[],
  inputLines: SaleInput['lines'],
  billDiscountMinor: number
): SaleTotals {
  if (products.length !== inputLines.length) {
    throw new Error('Every sale line must match a product')
  }
  if (!Number.isSafeInteger(billDiscountMinor) || billDiscountMinor < 0) {
    throw new Error('Bill discount must be a non-negative whole number of minor currency units')
  }

  const preliminary = inputLines.map((line, index) => {
    const product = products[index]
    if (!product || product.id !== line.productId) {
      throw new Error('Sale product order does not match the cart')
    }

    const grossLineMinor = roundMinorProduct(product.sellingPriceMinor, line.quantityMilli)
    if (line.lineDiscountMinor > grossLineMinor) {
      throw new Error(`Item discount exceeds the price for ${product.name}`)
    }
    return {
      product,
      quantityMilli: line.quantityMilli,
      grossLineMinor,
      lineDiscountMinor: line.lineDiscountMinor,
      preBillDiscountMinor: grossLineMinor - line.lineDiscountMinor,
      costOfGoodsMinor: roundMinorProduct(product.costPriceMinor, line.quantityMilli)
    }
  })

  const preBillTotal = preliminary.reduce((sum, line) => sum + BigInt(line.preBillDiscountMinor), 0n)
  const billDiscount = BigInt(billDiscountMinor)
  if (billDiscount > preBillTotal) {
    throw new Error('Bill discount cannot exceed the amount due after item discounts')
  }

  const billAllocations = allocateMinorProportionally(
    preliminary.map((line) => line.preBillDiscountMinor),
    billDiscountMinor
  )

  const lines = preliminary.map((line, index): CalculatedSaleLine => {
    const billAllocation = BigInt(billAllocations[index])
    return {
      product: line.product,
      quantityMilli: line.quantityMilli,
      grossLineMinor: line.grossLineMinor,
      lineDiscountMinor: line.lineDiscountMinor,
      allocatedBillDiscountMinor: safeNumber(billAllocation, 'Bill discount allocation'),
      netLineMinor: safeNumber(BigInt(line.preBillDiscountMinor) - billAllocation, 'Net sale line'),
      costOfGoodsMinor: line.costOfGoodsMinor
    }
  })

  const grossSalesMinor = lines.reduce((sum, line) => sum + BigInt(line.grossLineMinor), 0n)
  const lineDiscountsMinor = lines.reduce((sum, line) => sum + BigInt(line.lineDiscountMinor), 0n)
  const netSalesMinor = lines.reduce((sum, line) => sum + BigInt(line.netLineMinor), 0n)
  const costOfGoodsMinor = lines.reduce((sum, line) => sum + BigInt(line.costOfGoodsMinor), 0n)

  return {
    lines,
    grossSalesMinor: safeNumber(grossSalesMinor, 'Gross sales'),
    lineDiscountsMinor: safeNumber(lineDiscountsMinor, 'Item discounts'),
    billDiscountMinor,
    netSalesMinor: safeNumber(netSalesMinor, 'Net sales'),
    costOfGoodsMinor: safeNumber(costOfGoodsMinor, 'Cost of goods')
  }
}
