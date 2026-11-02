import { z } from 'zod'

const nonNegativeMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveMinor = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

export const openCashSessionSchema = z.object({
  openingCashMinor: nonNegativeMinor
})

export const closeCashSessionSchema = z.object({
  actualCashMinor: nonNegativeMinor
})

export const manualCashMovementSchema = z.object({
  direction: z.enum(['in', 'out']),
  amountMinor: positiveMinor,
  reason: z.string().trim().min(1).max(300)
})

export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>
export type ManualCashMovementInput = z.infer<typeof manualCashMovementSchema>

export interface CashMovement {
  id: string
  direction: 'in' | 'out'
  movementType: string
  amountMinor: number
  reason: string
  createdAt: string
}

export interface CashSession {
  id: string
  businessDate: string
  openingCashMinor: number
  expectedCashMinor: number
  actualCashMinor: number | null
  discrepancyMinor: number | null
  status: 'open' | 'closed'
  openedAt: string
  closedAt: string | null
  movements: CashMovement[]
}

export interface CashStatus {
  current: CashSession | null
  today: CashSession | null
}
