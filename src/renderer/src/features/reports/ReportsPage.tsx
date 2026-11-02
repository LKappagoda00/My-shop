import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReportData, ReportRange } from '../../../../shared/reports'
import { sriLankaBusinessDate } from '../../../../shared/business-date'
import { formatMoney, formatQuantity } from '../../../../shared/precision'
import { LocalizeTree } from '../../localization'

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function csvCell(value: string | number): string {
  let text = String(value)
  if (typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function formatReportMoney(minor: number): string {
  return minor < 0 ? `-${formatMoney(-minor)}` : formatMoney(minor)
}

function makeCsv(report: ReportData): string {
  const rows: Array<Array<string | number>> = [
    ['section', 'date', 'name', 'sku', 'quantity_milli', 'amount_minor', 'cost_minor', 'profit_minor'],
    ['range', `${report.fromDate} to ${report.toDate}`, '', '', '', '', '', '']
  ]
  Object.entries(report.totals).forEach(([name, amount]) => {
    rows.push(['totals', '', name, '', '', amount, '', ''])
  })
  report.daily.forEach((row) => {
    rows.push([
      'daily', row.businessDate, '', '', '', row.netSalesMinor,
      row.costOfGoodsMinor, row.netProfitMinor
    ])
  })
  report.bestSelling.forEach((row) => {
    rows.push([
      'product', '', row.name, '', row.quantitySoldMilli, row.netSalesMinor,
      row.costOfGoodsMinor, row.grossProfitMinor
    ])
  })
  report.expensesByCategory.forEach((row) => {
    rows.push(['expense', '', row.category, '', '', row.amountMinor, '', ''])
  })
  report.lowStock.forEach((row) => {
    rows.push(['low_stock', '', row.name, row.sku, row.stockOnHandMilli, '', '', ''])
  })
  report.supplierBalances.forEach((row) => {
    rows.push(['supplier_balance', '', row.supplierName, '', '', row.outstandingMinor, '', ''])
  })
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function downloadCsv(report: ReportData): void {
  const url = URL.createObjectURL(new Blob([makeCsv(report)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `shop-report-${report.fromDate}-${report.toDate}.csv`
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const metricLabels: Array<{ key: keyof ReportData['totals']; label: string; detail?: string }> = [
  { key: 'grossSalesMinor', label: 'Gross sales' },
  { key: 'discountsMinor', label: 'Discounts' },
  { key: 'returnsMinor', label: 'Returns' },
  { key: 'netSalesMinor', label: 'Net sales' },
  { key: 'costOfGoodsMinor', label: 'Cost of goods' },
  { key: 'grossProfitMinor', label: 'Gross profit' },
  { key: 'expensesMinor', label: 'Operating expenses' },
  { key: 'netProfitMinor', label: 'Net profit', detail: 'After operating expenses' },
  { key: 'purchasesMinor', label: 'Inventory received' },
  { key: 'supplierPaymentsMinor', label: 'Supplier payments' },
  { key: 'cashReceivedMinor', label: 'Cash received' },
  { key: 'cashPaidMinor', label: 'Cash paid' },
  { key: 'stockValueMinor', label: 'Current stock value', detail: 'Current on-hand inventory' }
]

export default function ReportsPage() {
  const today = useMemo(() => sriLankaBusinessDate(), [])
  const [range, setRange] = useState<ReportRange>({
    fromDate: monthStart(today),
    toDate: today
  })
  const [report, setReport] = useState<ReportData>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.shopApi) {
      setReport(undefined)
      return
    }
    if (range.fromDate > range.toDate) {
      setError('Start date must be on or before end date')
      setReport(undefined)
      return
    }
    setLoading(true)
    setError('')
    try {
      setReport(await window.shopApi.getReport(range))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const maxDailySales = Math.max(1, ...((report?.daily ?? []).map((row) => row.netSalesMinor)))

  return (
    <LocalizeTree>
    <main className="mx-auto max-w-[1500px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard & reports</h1>
          <p className="mt-1 text-sm text-slate-500">Sales, margins, expenses, inventory, and shop activity</p>
        </div>
        <div className="no-print flex flex-wrap items-end gap-3">
          <label className="field">
            Start date
            <input
              type="date"
              value={range.fromDate}
              max={range.toDate}
              onChange={(event) => setRange((current) => ({ ...current, fromDate: event.target.value }))}
            />
            <span className="field-hint">Start date for the report. Dates use Sri Lanka business time.</span>
          </label>
          <label className="field">
            End date
            <input
              type="date"
              value={range.toDate}
              min={range.fromDate}
              onChange={(event) => setRange((current) => ({ ...current, toDate: event.target.value }))}
            />
            <span className="field-hint">End date for the report, inclusive.</span>
          </label>
          <button className="button-secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Updating…' : 'Refresh'}
          </button>
          <button className="button-secondary" onClick={() => window.print()} disabled={!report}>
            Print
          </button>
          <button className="button-primary" onClick={() => report && downloadCsv(report)} disabled={!report}>
            Export CSV
          </button>
        </div>
      </div>

      {!window.shopApi && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Browser preview only. Reports require the Electron local database.
        </div>
      )}
      {error && <p className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {loading && !report && <p className="text-sm text-slate-500" role="status">Loading report…</p>}
      {report && (
        <div className="print-area space-y-6">
          <section aria-label="Financial summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metricLabels.map(({ key, label, detail }) => (
              <article className="metric-card" key={key}>
                <p>{label}</p>
                <strong className={key === 'netProfitMinor' && report.totals[key] < 0 ? 'text-red-700' : ''}>
                  {formatMoney(report.totals[key])}
                </strong>
                {detail && <span>{detail}</span>}
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Daily net sales</h2>
                <p className="text-xs text-slate-500">Net of discounts and returns · {report.fromDate} to {report.toDate}</p>
              </div>
              {report.daily.length > 0 && <span className="text-xs text-slate-500">{report.daily.length} trading days</span>}
            </div>
            {report.daily.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No sales, returns, or expenses in this date range.</p>
            ) : (
              <>
                <div className="flex h-48 items-end gap-2 overflow-x-auto border-b border-slate-200 px-2">
                  {report.daily.map((row) => {
                    const height = Math.max(3, Math.round(Math.max(0, row.netSalesMinor) / maxDailySales * 100))
                    return (
                      <div className="flex h-full min-w-8 flex-1 flex-col items-center justify-end gap-1" key={row.businessDate}>
                        <div
                          className="w-full max-w-12 rounded-t bg-emerald-600"
                          style={{ height: `${height}%` }}
                          title={`${row.businessDate}: ${formatReportMoney(row.netSalesMinor)}`}
                          aria-label={`${row.businessDate}: ${formatReportMoney(row.netSalesMinor)}`}
                        />
                        <span className="mb-2 text-[10px] text-slate-500">{row.businessDate.slice(8)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Gross</th><th>Discounts</th><th>Returns</th><th>Net sales</th><th>Cost</th><th>Expenses</th><th>Net profit</th></tr></thead>
                    <tbody>
                      {report.daily.map((row) => (
                        <tr key={row.businessDate}>
                          <td>{row.businessDate}</td>
                          <td>{formatReportMoney(row.grossSalesMinor)}</td>
                          <td>{formatReportMoney(row.discountsMinor)}</td>
                          <td>{formatReportMoney(row.returnsMinor)}</td>
                          <td>{formatReportMoney(row.netSalesMinor)}</td>
                          <td>{formatReportMoney(row.costOfGoodsMinor)}</td>
                          <td>{formatReportMoney(row.expensesMinor)}</td>
                          <td>{formatReportMoney(row.netProfitMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Best-selling products</h2>
              {report.bestSelling.length === 0 ? <p className="text-sm text-slate-500">No product sales in this date range.</p> : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Product</th><th>Net quantity</th><th>Net sales</th><th>Cost</th><th>Gross profit</th></tr></thead>
                    <tbody>{report.bestSelling.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.name}</td>
                        <td>{formatQuantity(row.quantitySoldMilli)}</td>
                        <td>{formatReportMoney(row.netSalesMinor)}</td>
                        <td>{formatReportMoney(row.costOfGoodsMinor)}</td>
                        <td>{formatReportMoney(row.grossProfitMinor)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Expenses by category</h2>
              {report.expensesByCategory.length === 0 ? <p className="text-sm text-slate-500">No operating expenses in this date range.</p> : (
                <table className="data-table">
                  <thead><tr><th>Category</th><th>Amount</th></tr></thead>
                  <tbody>{report.expensesByCategory.map((row) => (
                    <tr key={row.category}><td>{row.category}</td><td>{formatReportMoney(row.amountMinor)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Low stock</h2>
              {report.lowStock.length === 0 ? <p className="text-sm text-slate-500">No products are at or below minimum stock.</p> : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Product</th><th>SKU</th><th>On hand</th><th>Minimum</th></tr></thead>
                    <tbody>{report.lowStock.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td><td>{row.sku}</td>
                        <td>{formatQuantity(row.stockOnHandMilli)} {row.unit}</td>
                        <td>{formatQuantity(row.minimumStockMilli)} {row.unit}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Supplier balances</h2>
              {report.supplierBalances.length === 0 ? <p className="text-sm text-slate-500">No suppliers recorded.</p> : (
                <table className="data-table">
                  <thead><tr><th>Supplier</th><th>Outstanding balance</th></tr></thead>
                  <tbody>{report.supplierBalances.map((row) => (
                    <tr key={row.supplierId}><td>{row.supplierName}</td><td>{formatReportMoney(row.outstandingMinor)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
          </div>

          <section className="flex flex-wrap gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
            <span>Sync queue: <strong>{report.pendingSyncCount}</strong> pending · <strong>{report.syncingSyncCount}</strong> syncing · <strong>{report.failedSyncCount}</strong> failed</span>
            <span>Last successful sync: <strong>{report.lastSuccessfulSyncAt ?? 'Never'}</strong></span>
          </section>
        </div>
      )}
    </main>
    </LocalizeTree>
  )
}
