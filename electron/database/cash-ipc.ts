import { z } from 'zod'
import {
  closeCashSessionSchema,
  manualCashMovementSchema,
  openCashSessionSchema
} from '../../src/shared/cash'
import { CashRepository } from './cash-repository'
import type { IpcHandlerRegistry } from './handler-registry'

function register<TInput, TOutput>(
  channel: string,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry,
  schema: z.ZodType<TInput>,
  action: (input: TInput) => TOutput
): void {
  registry.handle(channel, (event, value) => {
    if (event.sender !== trustedContents()) throw new Error('Rejected request from an untrusted renderer')
    const result = schema.safeParse(value)
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ')
      throw new Error(`Invalid request: ${detail}`)
    }
    return action(result.data)
  })
}

export function registerCashIpc(
  repository: CashRepository,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  register('cash:status', trustedContents, registry, z.object({}), () =>
    repository.getStatus())
  register('cash:open', trustedContents, registry, openCashSessionSchema, (input) =>
    repository.openSession(input))
  register('cash:close', trustedContents, registry, closeCashSessionSchema, (input) =>
    repository.closeSession(input))
  register('cash:movement', trustedContents, registry, manualCashMovementSchema, (input) =>
    repository.recordManualMovement(input))
}

export function removeCashIpc(registry: IpcHandlerRegistry): void {
  registry.removeHandler('cash:status')
  registry.removeHandler('cash:open')
  registry.removeHandler('cash:close')
  registry.removeHandler('cash:movement')
}
