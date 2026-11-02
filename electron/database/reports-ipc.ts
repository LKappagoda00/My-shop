import { reportRangeSchema } from '../../src/shared/reports'
import { ReportsRepository } from './reports-repository'
import type { IpcHandlerRegistry } from './handler-registry'

const rangeSchema = reportRangeSchema.refine(
  ({ fromDate, toDate }) => fromDate <= toDate,
  { message: 'Start date must be on or before end date', path: ['toDate'] }
)

export function registerReportsIpc(
  repository: ReportsRepository,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  registry.handle('reports:get', (event, value) => {
    if (event.sender !== trustedContents()) throw new Error('Rejected request from an untrusted renderer')
    const result = rangeSchema.safeParse(value)
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ')
      throw new Error(`Invalid request: ${detail}`)
    }
    return repository.getReport(result.data)
  })
}

export function removeReportsIpc(registry: IpcHandlerRegistry): void {
  registry.removeHandler('reports:get')
}
