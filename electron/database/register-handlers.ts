import type { DatabaseSync } from 'node:sqlite'
import { CatalogRepository } from './catalog-repository'
import { registerCatalogIpc, removeCatalogIpc } from './catalog-ipc'
import { SalesRepository } from './sales-repository'
import { registerSalesIpc, removeSalesIpc } from './sales-ipc'
import { ProcurementRepository } from './procurement-repository'
import { registerProcurementIpc, removeProcurementIpc } from './procurement-ipc'
import { ReturnsRepository } from './returns-repository'
import { registerReturnsIpc, removeReturnsIpc } from './returns-ipc'
import { CashRepository } from './cash-repository'
import { registerCashIpc, removeCashIpc } from './cash-ipc'
import { ReportsRepository } from './reports-repository'
import { registerReportsIpc, removeReportsIpc } from './reports-ipc'
import { HeldSalesRepository } from './held-sales-repository'
import { registerHeldSalesIpc, removeHeldSalesIpc } from './held-sales-ipc'
import type { IpcHandlerRegistry } from './handler-registry'

export function registerShopHandlers(
  database: DatabaseSync,
  trustedContents: () => unknown,
  registry: IpcHandlerRegistry
): void {
  registerCatalogIpc(new CatalogRepository(database), trustedContents, registry)
  registerSalesIpc(new SalesRepository(database), trustedContents, registry)
  registerProcurementIpc(new ProcurementRepository(database), trustedContents, registry)
  registerReturnsIpc(new ReturnsRepository(database), trustedContents, registry)
  registerCashIpc(new CashRepository(database), trustedContents, registry)
  registerReportsIpc(new ReportsRepository(database), trustedContents, registry)
  registerHeldSalesIpc(new HeldSalesRepository(database), trustedContents, registry)
}

export function removeShopHandlers(registry: IpcHandlerRegistry): void {
  removeCatalogIpc(registry)
  removeSalesIpc(registry)
  removeProcurementIpc(registry)
  removeReturnsIpc(registry)
  removeCashIpc(registry)
  removeReportsIpc(registry)
  removeHeldSalesIpc(registry)
}
