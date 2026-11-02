import { z } from 'zod'
import type { Product } from './catalog'
import { isBusinessDate } from './business-date'
import { paymentMethods } from './sales'

const nonNegativeMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveMinor = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const positiveMilli = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(80).default(''),
  address: z.string().trim().max(500).default(''),
  notes: z.string().trim().max(1000).default('')
})

export const purchaseDraftInputSchema = z.object({
  supplierId: z.string().uuid(),
  supplierInvoiceNumber: z.string().trim().max(100).default(''),
  additionalCostsMinor: nonNegativeMinor.default(0),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantityMilli: positiveMilli,
    unitCostMinor: nonNegativeMinor
  })).min(1).max(300)
})

export const receivePurchaseSchema = z.object({
  id: z.string().uuid(),
  payments: z.array(z.object({
    method: z.enum(paymentMethods),
    amountMinor: positiveMinor,
    reference: z.string().trim().max(160).default('')
  })).max(20).default([])
})

export const supplierPaymentSchema = z.object({
  purchaseId: z.string().uuid(),
  method: z.enum(paymentMethods),
  amountMinor: positiveMinor,
  reference: z.string().trim().max(160).default('')
})

export const expenseInputSchema = z.object({
  categoryId: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  amountMinor: positiveMinor,
  method: z.enum(paymentMethods),
  businessDate: z.string().refine(isBusinessDate, 'Enter a valid calendar date')
})

export type SupplierInput = z.infer<typeof supplierInputSchema>
export type PurchaseDraftInput = z.infer<typeof purchaseDraftInputSchema>
export type ReceivePurchaseInput = z.infer<typeof receivePurchaseSchema>
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>
export type ExpenseInput = z.infer<typeof expenseInputSchema>

export interface Supplier {
  id: string
  name: string
  phone: string
  address: string
  notes: string
  archived: boolean
  outstandingMinor: number
  createdAt: string
  updatedAt: string
}

export interface PurchaseSummary {
  id: string
  purchaseNumber: string
  supplierId: string
  supplierName: string
  supplierInvoiceNumber: string | null
  status: 'draft' | 'received' | 'cancelled'
  additionalCostsMinor: number
  totalCostMinor: number
  amountPaidMinor: number
  balanceMinor: number
  createdAt: string
  receivedAt: string | null
}

export interface PurchaseItem {
  productId: string
  productName: string
  sku: string
  unit: Product['unit']
  quantityMilli: number
  unitCostMinor: number
  extendedCostMinor: number
  landedCostMinor: number
}

export interface PurchasePayment {
  method: (typeof paymentMethods)[number]
  amountMinor: number
  reference: string
  createdAt: string
}

export interface PurchaseDetail extends PurchaseSummary {
  items: PurchaseItem[]
  payments: PurchasePayment[]
}

export interface ExpenseCategory {
  id: string
  name: string
  archived: boolean
}

export interface Expense {
  id: string
  categoryId: string
  categoryName: string
  description: string
  amountMinor: number
  method: (typeof paymentMethods)[number]
  businessDate: string
  archived: boolean
  createdAt: string
}
