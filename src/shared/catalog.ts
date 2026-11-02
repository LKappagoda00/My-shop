import { z } from 'zod'

export const productUnits = ['piece', 'packet', 'kg', 'g', 'litre', 'ml'] as const
export const stockMovementTypes = [
  'opening',
  'adjustment',
  'purchase',
  'sale',
  'return',
  'purchase_return',
  'damage'
] as const

const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const signedInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default('')
})

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(100).default(''),
  categoryId: z.string().uuid().nullable().default(null),
  unit: z.enum(productUnits),
  costPriceMinor: nonNegativeInteger,
  sellingPriceMinor: nonNegativeInteger,
  minimumStockMilli: nonNegativeInteger,
  openingStockMilli: nonNegativeInteger.default(0)
})

export const productUpdateSchema = productInputSchema.omit({ openingStockMilli: true })
export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  quantityDeltaMilli: signedInteger.refine((value) => value !== 0, 'Adjustment must not be zero'),
  reason: z.string().trim().min(1).max(300)
})
export const stockReconciliationSchema = z.object({
  productId: z.string().uuid(),
  countedQuantityMilli: nonNegativeInteger,
  reason: z.string().trim().min(1).max(300)
})

export type CategoryInput = z.infer<typeof categoryInputSchema>
export type ProductInput = z.infer<typeof productInputSchema>
export type ProductUpdate = z.infer<typeof productUpdateSchema>
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>
export type StockReconciliationInput = z.infer<typeof stockReconciliationSchema>

export interface Category {
  id: string
  name: string
  description: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: string
  name: string
  sku: string
  barcode: string | null
  categoryId: string | null
  categoryName: string | null
  unit: (typeof productUnits)[number]
  costPriceMinor: number
  sellingPriceMinor: number
  minimumStockMilli: number
  stockOnHandMilli: number
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface StockMovement {
  id: string
  productId: string
  productName: string
  sku: string
  movementType: (typeof stockMovementTypes)[number]
  quantityDeltaMilli: number
  unitCostMinor: number
  reason: string
  referenceId: string | null
  createdAt: string
}
