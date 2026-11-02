import type {
  Category,
  CategoryInput,
  Product,
  ProductInput,
  ProductUpdate,
  StockMovement,
  StockReconciliationInput,
  StockAdjustmentInput
} from './catalog'
import type {
  HeldSale,
  HeldSaleInput,
  SaleDetail,
  SaleInput,
  SaleSummary,
  SaleVoidInput
} from './sales'
import type {
  Expense,
  ExpenseCategory,
  ExpenseInput,
  PurchaseDetail,
  PurchaseDraftInput,
  PurchaseSummary,
  ReceivePurchaseInput,
  Supplier,
  SupplierInput,
  SupplierPaymentInput
} from './procurement'
import type {
  SalesReturnDetail,
  SalesReturnInput,
  SalesReturnSummary
} from './returns'
import type {
  CashSession,
  CashStatus,
  CloseCashSessionInput,
  ManualCashMovementInput,
  OpenCashSessionInput
} from './cash'
import type { ReportData, ReportRange } from './reports'

export type ShopInvoke = (channel: string, value?: unknown) => Promise<unknown>

export function createShopApi(invoke: ShopInvoke) {
  return {
    getAppVersion: (): Promise<string> => invoke('app:get-version') as Promise<string>,
    listCategories: (includeArchived = false): Promise<Category[]> =>
      invoke('catalog:categories:list', { includeArchived }) as Promise<Category[]>,
    createCategory: (input: CategoryInput): Promise<Category> =>
      invoke('catalog:categories:create', input) as Promise<Category>,
    updateCategory: (id: string, input: CategoryInput): Promise<Category> =>
      invoke('catalog:categories:update', { id, input }) as Promise<Category>,
    archiveCategory: (id: string): Promise<void> =>
      invoke('catalog:categories:archive', { id }) as Promise<void>,
    restoreCategory: (id: string): Promise<void> =>
      invoke('catalog:categories:restore', { id }) as Promise<void>,
    listProducts: (search = '', includeArchived = false): Promise<Product[]> =>
      invoke('catalog:products:list', { search, includeArchived }) as Promise<Product[]>,
    createProduct: (input: ProductInput): Promise<Product> =>
      invoke('catalog:products:create', input) as Promise<Product>,
    importProducts: (inputs: ProductInput[]): Promise<Product[]> =>
      invoke('catalog:products:import', inputs) as Promise<Product[]>,
    updateProduct: (id: string, input: ProductUpdate): Promise<Product> =>
      invoke('catalog:products:update', { id, input }) as Promise<Product>,
    archiveProduct: (id: string): Promise<void> =>
      invoke('catalog:products:archive', { id }) as Promise<void>,
    restoreProduct: (id: string): Promise<void> =>
      invoke('catalog:products:restore', { id }) as Promise<void>,
    adjustStock: (input: StockAdjustmentInput): Promise<Product> =>
      invoke('catalog:stock:adjust', input) as Promise<Product>,
    reconcileStock: (input: StockReconciliationInput): Promise<Product> =>
      invoke('catalog:stock:reconcile', input) as Promise<Product>,
    listStockMovements: (productId?: string, limit = 100): Promise<StockMovement[]> =>
      invoke('catalog:stock:history', { productId, limit }) as Promise<StockMovement[]>,
    createSale: (input: SaleInput): Promise<SaleDetail> =>
      invoke('sales:create', input) as Promise<SaleDetail>,
    listSales: (search = '', businessDate?: string): Promise<SaleSummary[]> =>
      invoke('sales:list', { search, businessDate }) as Promise<SaleSummary[]>,
    getSale: (id: string): Promise<SaleDetail | null> =>
      invoke('sales:get', { id }) as Promise<SaleDetail | null>,
    voidSale: (input: SaleVoidInput): Promise<SaleDetail> =>
      invoke('sales:void', input) as Promise<SaleDetail>,
    listHeldSales: (): Promise<HeldSale[]> => invoke('held-sales:list') as Promise<HeldSale[]>,
    saveHeldSale: (input: HeldSaleInput): Promise<HeldSale> =>
      invoke('held-sales:save', input) as Promise<HeldSale>,
    deleteHeldSale: (id: string): Promise<void> =>
      invoke('held-sales:delete', { id }) as Promise<void>,
    listSuppliers: (search = '', includeArchived = false): Promise<Supplier[]> =>
      invoke('suppliers:list', { search, includeArchived }) as Promise<Supplier[]>,
    createSupplier: (input: SupplierInput): Promise<Supplier> =>
      invoke('suppliers:create', input) as Promise<Supplier>,
    updateSupplier: (id: string, input: SupplierInput): Promise<Supplier> =>
      invoke('suppliers:update', { id, input }) as Promise<Supplier>,
    archiveSupplier: (id: string): Promise<void> =>
      invoke('suppliers:archive', { id }) as Promise<void>,
    restoreSupplier: (id: string): Promise<void> =>
      invoke('suppliers:restore', { id }) as Promise<void>,
    listPurchases: (search = ''): Promise<PurchaseSummary[]> =>
      invoke('purchases:list', { search }) as Promise<PurchaseSummary[]>,
    getPurchase: (id: string): Promise<PurchaseDetail | null> =>
      invoke('purchases:get', { id }) as Promise<PurchaseDetail | null>,
    createPurchaseDraft: (input: PurchaseDraftInput): Promise<PurchaseDetail> =>
      invoke('purchases:create-draft', input) as Promise<PurchaseDetail>,
    updatePurchaseDraft: (id: string, input: PurchaseDraftInput): Promise<PurchaseDetail> =>
      invoke('purchases:update-draft', { id, input }) as Promise<PurchaseDetail>,
    cancelPurchaseDraft: (id: string): Promise<void> =>
      invoke('purchases:cancel-draft', { id }) as Promise<void>,
    reopenCancelledPurchase: (id: string): Promise<PurchaseDetail> =>
      invoke('purchases:reopen-cancelled', { id }) as Promise<PurchaseDetail>,
    receivePurchase: (input: ReceivePurchaseInput): Promise<PurchaseDetail> =>
      invoke('purchases:receive', input) as Promise<PurchaseDetail>,
    recordSupplierPayment: (input: SupplierPaymentInput): Promise<PurchaseDetail> =>
      invoke('purchases:record-payment', input) as Promise<PurchaseDetail>,
    listExpenseCategories: (): Promise<ExpenseCategory[]> =>
      invoke('expenses:categories', {}) as Promise<ExpenseCategory[]>,
    listExpenses: (
      search = '',
      fromDate?: string,
      toDate?: string,
      includeArchived = false
    ): Promise<Expense[]> =>
      invoke('expenses:list', { search, fromDate, toDate, includeArchived }) as Promise<Expense[]>,
    createExpense: (input: ExpenseInput): Promise<Expense> =>
      invoke('expenses:create', input) as Promise<Expense>,
    updateExpense: (id: string, input: ExpenseInput): Promise<Expense> =>
      invoke('expenses:update', { id, input }) as Promise<Expense>,
    archiveExpense: (id: string): Promise<void> =>
      invoke('expenses:archive', { id }) as Promise<void>,
    restoreExpense: (id: string): Promise<void> =>
      invoke('expenses:restore', { id }) as Promise<void>,
    createSalesReturn: (input: SalesReturnInput): Promise<SalesReturnDetail> =>
      invoke('returns:create', input) as Promise<SalesReturnDetail>,
    listSalesReturns: (search = ''): Promise<SalesReturnSummary[]> =>
      invoke('returns:list', { search }) as Promise<SalesReturnSummary[]>,
    getSalesReturn: (id: string): Promise<SalesReturnDetail | null> =>
      invoke('returns:get', { id }) as Promise<SalesReturnDetail | null>,
    getCashStatus: (): Promise<CashStatus> => invoke('cash:status', {}) as Promise<CashStatus>,
    openCashSession: (input: OpenCashSessionInput): Promise<CashSession> =>
      invoke('cash:open', input) as Promise<CashSession>,
    closeCashSession: (input: CloseCashSessionInput): Promise<CashSession> =>
      invoke('cash:close', input) as Promise<CashSession>,
    recordCashMovement: (input: ManualCashMovementInput): Promise<CashSession> =>
      invoke('cash:movement', input) as Promise<CashSession>,
    getReport: (range: ReportRange): Promise<ReportData> =>
      invoke('reports:get', range) as Promise<ReportData>
  }
}

export type ShopApi = ReturnType<typeof createShopApi>
