import type { DatabaseSync } from 'node:sqlite'
import { roundMinorProduct } from '../../src/shared/financial'
import type {
  DailyReportRow,
  ExpenseBreakdownRow,
  LowStockProduct,
  ProductSalesReport,
  ReportData,
  ReportRange,
  SupplierBalanceReport
} from '../../src/shared/reports'

interface NumericRow {
  [column: string]: number | bigint | null
}

function safeInteger(value: number | bigint | null, label: string): number {
  if (value === null) return 0
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${label} exceeds the supported financial range`)
  }
  const integer = typeof value === 'bigint' ? value : BigInt(value)
  if (integer < BigInt(Number.MIN_SAFE_INTEGER) || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the supported financial range`)
  }
  return Number(integer)
}

function sumByDate(database: DatabaseSync, query: string, fromDate: string, toDate: string): Map<string, NumericRow> {
  const rows = database.prepare(query).all(fromDate, toDate) as unknown as Array<NumericRow & {
    business_date: string
  }>
  return new Map(rows.map((row) => [String(row.business_date), row]))
}

export class ReportsRepository {
  constructor(private readonly database: DatabaseSync) {}

  getReport(range: ReportRange): ReportData {
    if (range.fromDate > range.toDate) throw new Error('Report start date must be on or before its end date')

    const sales = this.database.prepare(`
      SELECT COALESCE(SUM(gross_sales_minor), 0) AS gross,
        COALESCE(SUM(line_discounts_minor + bill_discount_minor), 0) AS discounts,
        COALESCE(SUM(cost_of_goods_minor), 0) AS cost
      FROM sales WHERE business_date BETWEEN ? AND ? AND status != 'voided'
    `).all(range.fromDate, range.toDate)[0] as NumericRow
    const returns = this.database.prepare(`
      SELECT COALESCE(SUM(refund_minor), 0) AS refunds,
        COALESCE(SUM(cost_reversal_minor), 0) AS cost_reversed
      FROM sales_returns WHERE business_date BETWEEN ? AND ?
    `).all(range.fromDate, range.toDate)[0] as NumericRow
    const expenses = this.database.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS amount
      FROM expenses WHERE business_date BETWEEN ? AND ? AND archived = 0
    `).all(range.fromDate, range.toDate)[0] as NumericRow
    const purchases = this.database.prepare(`
      SELECT COALESCE(SUM(total_cost_minor), 0) AS amount
      FROM purchases
      WHERE received_business_date BETWEEN ? AND ? AND status = 'received'
    `).all(range.fromDate, range.toDate)[0] as NumericRow
    const supplierPayments = this.database.prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS amount
      FROM supplier_payments WHERE business_date BETWEEN ? AND ?
    `).all(range.fromDate, range.toDate)[0] as NumericRow
    const cashReceived = this.database.prepare(`
      SELECT COALESCE(SUM(cm.amount_minor), 0) AS amount
      FROM cash_movements cm JOIN cash_sessions cs ON cs.id = cm.cash_session_id
      WHERE cm.direction = 'in' AND cs.business_date BETWEEN ? AND ?
    `).all(range.fromDate, range.toDate)[0] as NumericRow
    const cashPaid = this.database.prepare(`
      SELECT COALESCE(SUM(cm.amount_minor), 0) AS amount
      FROM cash_movements cm JOIN cash_sessions cs ON cs.id = cm.cash_session_id
      WHERE cm.direction = 'out' AND cs.business_date BETWEEN ? AND ?
    `).all(range.fromDate, range.toDate)[0] as NumericRow

    const grossSalesMinor = safeInteger(sales.gross, 'Gross sales')
    const discountsMinor = safeInteger(sales.discounts, 'Discounts')
    const returnsMinor = safeInteger(returns.refunds, 'Sales returns')
    const netSalesMinor = grossSalesMinor - discountsMinor - returnsMinor
    const costOfGoodsMinor = safeInteger(sales.cost, 'Cost of goods')
      - safeInteger(returns.cost_reversed, 'Returned cost')
    const expensesMinor = safeInteger(expenses.amount, 'Expenses')
    const grossProfitMinor = netSalesMinor - costOfGoodsMinor
    const netProfitMinor = grossProfitMinor - expensesMinor

    return {
      ...range,
      totals: {
        grossSalesMinor,
        discountsMinor,
        returnsMinor,
        netSalesMinor,
        costOfGoodsMinor,
        grossProfitMinor,
        expensesMinor,
        netProfitMinor,
        purchasesMinor: safeInteger(purchases.amount, 'Purchase totals'),
        supplierPaymentsMinor: safeInteger(supplierPayments.amount, 'Supplier payments'),
        cashReceivedMinor: safeInteger(cashReceived.amount, 'Cash received'),
        cashPaidMinor: safeInteger(cashPaid.amount, 'Cash paid'),
        stockValueMinor: this.stockValueMinor()
      },
      daily: this.dailyReport(range.fromDate, range.toDate),
      bestSelling: this.productSales(range.fromDate, range.toDate),
      expensesByCategory: this.expenseBreakdown(range.fromDate, range.toDate),
      lowStock: this.lowStock(),
      supplierBalances: this.supplierBalances(),
      pendingSyncCount: this.syncCount('pending'),
      syncingSyncCount: this.syncCount('syncing'),
      failedSyncCount: this.syncCount('failed'),
      lastSuccessfulSyncAt: this.database.prepare(`
        SELECT value FROM sync_metadata WHERE key = 'last_successful_sync_at'
      `).get()?.value as string | undefined ?? null
    }
  }

  private dailyReport(fromDate: string, toDate: string): DailyReportRow[] {
    const sales = sumByDate(this.database, `
      SELECT business_date, SUM(gross_sales_minor) AS gross,
        SUM(line_discounts_minor + bill_discount_minor) AS discounts,
        SUM(cost_of_goods_minor) AS cost
      FROM sales
      WHERE business_date BETWEEN ? AND ? AND status != 'voided'
      GROUP BY business_date
    `, fromDate, toDate)
    const returns = sumByDate(this.database, `
      SELECT business_date, SUM(refund_minor) AS amount,
        SUM(cost_reversal_minor) AS cost
      FROM sales_returns WHERE business_date BETWEEN ? AND ?
      GROUP BY business_date
    `, fromDate, toDate)
    const expenses = sumByDate(this.database, `
      SELECT business_date, SUM(amount_minor) AS amount
      FROM expenses WHERE business_date BETWEEN ? AND ? AND archived = 0
      GROUP BY business_date
    `, fromDate, toDate)
    const dates = [...new Set([...sales.keys(), ...returns.keys(), ...expenses.keys()])].sort()

    return dates.map((businessDate): DailyReportRow => {
      const sale = sales.get(businessDate)
      const returned = returns.get(businessDate)
      const gross = safeInteger(sale?.gross ?? null, 'Daily gross sales')
      const discounts = safeInteger(sale?.discounts ?? null, 'Daily discounts')
      const refund = safeInteger(returned?.amount ?? null, 'Daily returns')
      const cost = safeInteger(sale?.cost ?? null, 'Daily cost of goods')
        - safeInteger(returned?.cost ?? null, 'Daily returned cost')
      const expense = safeInteger(expenses.get(businessDate)?.amount ?? null, 'Daily expenses')
      const net = gross - discounts - refund
      return {
        businessDate,
        grossSalesMinor: gross,
        discountsMinor: discounts,
        returnsMinor: refund,
        netSalesMinor: net,
        costOfGoodsMinor: cost,
        expensesMinor: expense,
        netProfitMinor: net - cost - expense
      }
    })
  }

  private productSales(fromDate: string, toDate: string): ProductSalesReport[] {
    const sales = this.database.prepare(`
      SELECT si.product_id, MAX(si.product_name_snapshot) AS name,
        SUM(si.quantity_milli) AS quantity,
        SUM(si.net_line_minor) AS net_sales,
        SUM(si.cost_of_goods_minor) AS cost
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.business_date BETWEEN ? AND ? AND s.status != 'voided'
      GROUP BY si.product_id
    `).all(fromDate, toDate) as unknown as Array<{
      product_id: string
      name: string
      quantity: number
      net_sales: number
      cost: number
    }>
    const returns = this.database.prepare(`
      SELECT ri.product_id, MAX(ri.product_name_snapshot) AS name,
        SUM(ri.quantity_milli) AS quantity,
        SUM(ri.refund_minor) AS refund,
        SUM(ri.cost_reversal_minor) AS cost_reversed
      FROM sales_return_items ri JOIN sales_returns r ON r.id = ri.return_id
      WHERE r.business_date BETWEEN ? AND ?
      GROUP BY ri.product_id
    `).all(fromDate, toDate) as unknown as Array<{
      product_id: string
      name: string
      quantity: number
      refund: number
      cost_reversed: number
    }>
    const returnsByProduct = new Map(returns.map((row) => [row.product_id, row]))
    const salesByProduct = new Map(sales.map((row) => [row.product_id, row]))
    const productIds = new Set([...salesByProduct.keys(), ...returnsByProduct.keys()])

    return [...productIds].map((productId) => {
      const row = salesByProduct.get(productId)
      const returned = returnsByProduct.get(productId)
      const productName = row?.name ?? returned?.name
      if (!productName) throw new Error(`Missing product name for report product ${productId}`)
      const netSalesMinor = safeInteger(row?.net_sales ?? null, 'Product net sales')
        - safeInteger(returned?.refund ?? null, 'Product sales returns')
      const costOfGoodsMinor = safeInteger(row?.cost ?? null, 'Product cost')
        - safeInteger(returned?.cost_reversed ?? null, 'Product return cost')
      return {
        productId,
        name: productName,
        quantitySoldMilli: safeInteger(row?.quantity ?? null, 'Product quantity sold')
          - safeInteger(returned?.quantity ?? null, 'Product returned quantity'),
        netSalesMinor,
        costOfGoodsMinor,
        grossProfitMinor: netSalesMinor - costOfGoodsMinor
      }
    }).sort((left, right) => right.quantitySoldMilli - left.quantitySoldMilli).slice(0, 20)
  }

  private expenseBreakdown(fromDate: string, toDate: string): ExpenseBreakdownRow[] {
    const rows = this.database.prepare(`
      SELECT c.name AS category, SUM(e.amount_minor) AS amount
      FROM expenses e JOIN expense_categories c ON c.id = e.category_id
      WHERE e.business_date BETWEEN ? AND ? AND e.archived = 0
      GROUP BY c.id, c.name ORDER BY amount DESC
    `).all(fromDate, toDate) as unknown as Array<{ category: string; amount: number }>
    return rows.map((row) => ({
      category: row.category,
      amountMinor: safeInteger(row.amount, 'Expense category total')
    }))
  }

  private lowStock(): LowStockProduct[] {
    const rows = this.database.prepare(`
      SELECT p.id, p.name, p.sku, p.unit, p.minimum_stock_milli,
        COALESCE(SUM(sm.quantity_delta_milli), 0) AS stock_on_hand_milli
      FROM products p
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE p.archived = 0
      GROUP BY p.id
      HAVING stock_on_hand_milli <= p.minimum_stock_milli
      ORDER BY stock_on_hand_milli, p.name COLLATE NOCASE
      LIMIT 100
    `).all() as unknown as Array<{
      id: string
      name: string
      sku: string
      unit: string
      minimum_stock_milli: number
      stock_on_hand_milli: number
    }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      unit: row.unit,
      minimumStockMilli: safeInteger(row.minimum_stock_milli, 'Minimum stock'),
      stockOnHandMilli: safeInteger(row.stock_on_hand_milli, 'Stock on hand')
    }))
  }

  private supplierBalances(): SupplierBalanceReport[] {
    const rows = this.database.prepare(`
      SELECT s.id, s.name,
        COALESCE((
          SELECT SUM(p.total_cost_minor) FROM purchases p
          WHERE p.supplier_id = s.id AND p.status = 'received'
        ), 0) - COALESCE((
          SELECT SUM(sp.amount_minor) FROM supplier_payments sp
          WHERE sp.supplier_id = s.id
        ), 0) AS outstanding
      FROM suppliers s WHERE s.archived = 0
      ORDER BY outstanding DESC LIMIT 100
    `).all() as unknown as Array<{ id: string; name: string; outstanding: number }>
    return rows.map((row) => ({
      supplierId: row.id,
      supplierName: row.name,
      outstandingMinor: safeInteger(row.outstanding, 'Supplier balance')
    }))
  }

  private stockValueMinor(): number {
    const rows = this.database.prepare(`
      SELECT p.cost_price_minor,
        COALESCE(SUM(sm.quantity_delta_milli), 0) AS quantity
      FROM products p
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE p.archived = 0
      GROUP BY p.id
    `).all() as unknown as Array<{ cost_price_minor: number; quantity: number }>
    const value = rows.reduce((total, row) => (
      total + BigInt(roundMinorProduct(row.cost_price_minor, row.quantity))
    ), 0n)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Inventory value exceeds the supported financial range')
    }
    return Number(value)
  }

  private syncCount(status: 'pending' | 'syncing' | 'failed'): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM sync_queue WHERE status = ?
    `).get(status) as { count: number }
    return row.count
  }
}
