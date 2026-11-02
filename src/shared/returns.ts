import { z } from 'zod'
import type { Product } from './catalog'
import type { PaymentMethod } from './sales'

export const salesReturnInputSchema = z.object({
  saleId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().min(1).max(300),
  refundMethod: z.enum(['cash', 'card', 'bank_transfer', 'qr']),
  lines: z.array(z.object({
    saleItemId: z.string().uuid(),
    quantityMilli: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    restock: z.boolean()
  })).min(1).max(500)
})

export type SalesReturnInput = z.infer<typeof salesReturnInputSchema>

export interface SalesReturnItem {
  saleItemId: string
  productId: string
  productName: string
  unit: Product['unit']
  quantityMilli: number
  refundMinor: number
  costReversalMinor: number
  restocked: boolean
}

export interface SalesReturnSummary {
  id: string
  returnNumber: string
  saleId: string
  invoiceNumber: string
  reason: string
  refundMinor: number
  costReversalMinor: number
  createdAt: string
}

export interface SalesReturnDetail extends SalesReturnSummary {
  refundMethod: PaymentMethod
  items: SalesReturnItem[]
}
