import { z } from 'zod'
import { isBusinessDate } from './business-date'

export const reportRangeSchema = z.object({
  fromDate: z.string().refine(isBusinessDate, 'Enter a valid start date'),
  toDate: z.string().refine(isBusinessDate, 'Enter a valid end date')
})

export type ReportRange = z.infer<typeof reportRangeSchema>

export interface ReportTotals {
  grossSalesMinor: number
  discountsMinor: number
  returnsMinor: number
  netSalesMinor: number
  costOfGoodsMinor: number
  grossProfitMinor: number
  expensesMinor: number
  netProfitMinor: number
  purchasesMinor: number
  supplierPaymentsMinor: number
  cashReceivedMinor: number
  cashPaidMinor: number
  stockValueMinor: number
}

export interface DailyReportRow {
  businessDate: string
  grossSalesMinor: number
  discountsMinor: number
  returnsMinor: number
  netSalesMinor: number
  costOfGoodsMinor: number
  expensesMinor: number
  netProfitMinor: number
}

export interface ProductSalesReport {
  productId: string
  name: string
  quantitySoldMilli: number
  netSalesMinor: number
  costOfGoodsMinor: number
  grossProfitMinor: number
}

export interface ExpenseBreakdownRow {
  category: string
  amountMinor: number
}

export interface LowStockProduct {
  id: string
  name: string
  sku: string
  unit: string
  stockOnHandMilli: number
  minimumStockMilli: number
}

export interface SupplierBalanceReport {
  supplierId: string
  supplierName: string
  outstandingMinor: number
}

export interface ReportData {
  fromDate: string
  toDate: string
  totals: ReportTotals
  daily: DailyReportRow[]
  bestSelling: ProductSalesReport[]
  expensesByCategory: ExpenseBreakdownRow[]
  lowStock: LowStockProduct[]
  supplierBalances: SupplierBalanceReport[]
  pendingSyncCount: number
  syncingSyncCount: number
  failedSyncCount: number
  lastSuccessfulSyncAt: string | null
}
