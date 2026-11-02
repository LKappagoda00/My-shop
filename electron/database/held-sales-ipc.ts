import { z } from 'zod'
import { heldSaleInputSchema } from '../../src/shared/sales'
import { HeldSalesRepository } from './held-sales-repository'
import type { IpcHandlerRegistry } from './handler-registry'

const uuidSchema = z.object({ id: z.string().uuid() })

export function registerHeldSalesIpc(
  repository: HeldSalesRepository,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  registry.handle('held-sales:list', (event) => {
    if (event.sender !== trustedContents()) throw new Error('Rejected request from an untrusted renderer')
    return repository.listHeldSales()
  })
  registry.handle('held-sales:save', (event, value) => {
    if (event.sender !== trustedContents()) throw new Error('Rejected request from an untrusted renderer')
    const result = heldSaleInputSchema.safeParse(value)
    if (!result.success) {
      const detail = result.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
      throw new Error(`Invalid request: ${detail}`)
    }
    return repository.saveHeldSale(result.data)
  })
  registry.handle('held-sales:delete', (event, value) => {
    if (event.sender !== trustedContents()) throw new Error('Rejected request from an untrusted renderer')
    const result = uuidSchema.safeParse(value)
    if (!result.success) throw new Error('Invalid request: held sale id must be a UUID')
    return repository.deleteHeldSale(result.data.id)
  })
}

export function removeHeldSalesIpc(registry: IpcHandlerRegistry): void {
  for (const channel of ['held-sales:list', 'held-sales:save', 'held-sales:delete']) {
    registry.removeHandler(channel)
  }
}
