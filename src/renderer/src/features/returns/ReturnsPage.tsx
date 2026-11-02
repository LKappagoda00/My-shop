import { useMemo, useState, type FormEvent } from 'react'
import type { SaleDetail, SaleSummary } from '../../../../shared/sales'
import { paymentMethods } from '../../../../shared/sales'
import type { SalesReturnDetail, SalesReturnSummary } from '../../../../shared/returns'
import { salesReturnInputSchema } from '../../../../shared/returns'
import { proportionalMinorShare } from '../../../../shared/financial'
import { formatMoney, formatQuantity, parseDecimalToScaled } from '../../../../shared/precision'
import { LocalizeTree } from '../../localization'

interface ReturnDraftLine {
  quantity: string
  restock: boolean
}

const methodLabels = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  qr: 'QR payment'
} as const

export default function ReturnsPage() {
  const [saleSearch, setSaleSearch] = useState('')
  const [saleResults, setSaleResults] = useState<SaleSummary[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleDetail>()
  const [returnLines, setReturnLines] = useState<Record<string, ReturnDraftLine>>({})
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<(typeof paymentMethods)[number]>('cash')
  const [returnSearch, setReturnSearch] = useState('')
  const [returns, setReturns] = useState<SalesReturnSummary[]>([])
  const [selectedReturn, setSelectedReturn] = useState<SalesReturnDetail>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const estimates = useMemo(() => {
    if (!selectedSale) return { lines: [], total: 0, error: '' }
    try {
      const lines = selectedSale.items.flatMap((item) => {
        const draft = returnLines[item.id]
        if (!draft || !draft.quantity.trim()) return []
        const quantityMilli = parseDecimalToScaled(draft.quantity, 3)
        if (quantityMilli === 0) return []
        if (quantityMilli > item.returnableQuantityMilli) {
          throw new Error(`Return quantity exceeds the remaining eligible quantity for ${item.productName}`)
        }
        const cumulativeRefund = proportionalMinorShare(
          item.netLineMinor,
          item.returnedQuantityMilli + quantityMilli,
          item.quantityMilli
        )
        return [{
          saleItemId: item.id,
          quantityMilli,
          refundMinor: cumulativeRefund - item.returnedNetMinor
        }]
      })
      const total = lines.reduce((sum, line) => sum + BigInt(line.refundMinor), 0n)
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Refund exceeds the supported financial range')
      return { lines, total: Number(total), error: '' }
    } catch (estimateError) {
      return {
        lines: [],
        total: 0,
        error: estimateError instanceof Error ? estimateError.message : String(estimateError)
      }
    }
  }, [returnLines, selectedSale])

  async function searchSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    try {
      setSaleResults(await window.shopApi.listSales(saleSearch))
      setError('')
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError))
    }
  }

  async function selectSale(sale: SaleSummary) {
    if (!window.shopApi) return
    try {
      const detail = await window.shopApi.getSale(sale.id)
      if (!detail) throw new Error(`Sale ${sale.invoiceNumber} could not be found`)
      setSelectedSale(detail)
      setReturnLines(Object.fromEntries(detail.items.map((item) => [item.id, {
        quantity: '0.000',
        restock: true
      }])))
      setSelectedReturn(undefined)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }

  async function findReturns(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    try {
      setReturns(await window.shopApi.listSalesReturns(returnSearch))
      setError('')
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError))
    }
  }

  async function selectReturn(item: SalesReturnSummary) {
    if (!window.shopApi) return
    try {
      const detail = await window.shopApi.getSalesReturn(item.id)
      if (!detail) throw new Error(`Return ${item.returnNumber} could not be found`)
      setSelectedReturn(detail)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }

  async function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi || !selectedSale) return
    const parsed = salesReturnInputSchema.safeParse({
      saleId: selectedSale.id,
      idempotencyKey: crypto.randomUUID(),
      reason,
      refundMethod,
      lines: estimates.lines.map((line) => ({
        saleItemId: line.saleItemId,
        quantityMilli: line.quantityMilli,
        restock: returnLines[line.saleItemId].restock
      }))
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Select a return quantity and reason.')
      return
    }
    if (!parsed.data.lines.length) {
      setError('Enter a quantity to return.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const created = await window.shopApi.createSalesReturn(parsed.data)
      setSelectedReturn(created)
      setSelectedSale(await window.shopApi.getSale(selectedSale.id) ?? undefined)
      setReturnLines({})
      setReason('')
      setReturns(await window.shopApi.listSalesReturns(returnSearch))
      setSaleResults(await window.shopApi.listSales(saleSearch))
    } catch (returnError) {
      setError(returnError instanceof Error ? returnError.message : String(returnError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <LocalizeTree>
    <main className="mx-auto max-w-[1500px] px-6 py-8">
      {!window.shopApi && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Browser preview only. Sales returns require the Electron local database.
        </div>
      )}
      <div className="mb-7">
        <p className="text-sm font-medium text-emerald-700">CUSTOMER SERVICE</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sales returns</h1>
        <p className="mt-2 text-sm text-slate-500">Refund eligible sale quantities and restock only goods approved for resale.</p>
      </div>
      {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div>}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Find original sale</h2>
          <form className="mt-3 flex gap-2" onSubmit={(event) => void searchSale(event)}>
            <input aria-label="Search sale invoice" placeholder="Enter invoice number" value={saleSearch} onChange={(event) => setSaleSearch(event.target.value)} />
            <button type="submit" className="button-secondary" disabled={!window.shopApi}>Search</button>
          </form>
          <ul className="mt-3 divide-y divide-slate-100">
            {saleResults.map((sale) => (
              <li key={sale.id}>
                <button className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50" onClick={() => void selectSale(sale)}>
                  <span><span className="block text-sm font-medium">{sale.invoiceNumber}</span><span className="text-xs text-slate-500">{sale.businessDate} · {sale.status}</span></span>
                  <span className="text-sm font-semibold">{formatMoney(sale.netSalesMinor)}</span>
                </button>
              </li>
            ))}
            {saleResults.length === 0 && <li className="py-4 text-sm text-slate-500">Search an invoice to start a return.</li>}
          </ul>

          {selectedSale && (
            <form className="mt-5 border-t border-slate-100 pt-5" onSubmit={(event) => void submitReturn(event)}>
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold">{selectedSale.invoiceNumber}</h3><p className="mt-1 text-xs text-slate-500">{selectedSale.businessDate} · {selectedSale.status}</p></div>
                <button className="text-sm text-slate-500" type="button" onClick={() => setSelectedSale(undefined)}>Close</button>
              </div>
              <div className="mt-4 divide-y divide-slate-100">
                {selectedSale.items.map((item) => {
                  const draft = returnLines[item.id]
                  return (
                    <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3 py-3" key={item.id}>
                      <div>
                        <p className="text-sm font-medium">{item.productName}</p>
                        <p className="mt-1 text-xs text-slate-500">Sold {formatQuantity(item.quantityMilli)} · Returned {formatQuantity(item.returnedQuantityMilli)} · Eligible {formatQuantity(item.returnableQuantityMilli)}</p>
                        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                          <input type="checkbox" checked={draft?.restock ?? true} disabled={item.returnableQuantityMilli === 0} onChange={(event) => setReturnLines((current) => ({
                            ...current,
                            [item.id]: { quantity: current[item.id]?.quantity ?? '0.000', restock: event.target.checked }
                          }))} />
                          Resalable and safe to return to stock
                        </label>
                        <p className="mt-1 text-xs text-slate-500">Leave unchecked for damaged or unsellable items.</p>
                      </div>
                      <label className="field text-xs">Return qty
                        <input
                          inputMode="decimal"
                          aria-label={`${item.productName} return quantity`}
                          value={draft?.quantity ?? '0.000'}
                          disabled={item.returnableQuantityMilli === 0}
                          onChange={(event) => setReturnLines((current) => ({
                            ...current,
                            [item.id]: { quantity: event.target.value, restock: current[item.id]?.restock ?? true }
                          }))}
                        />
                        <span className="field-hint">Maximum: {formatQuantity(item.returnableQuantityMilli)}.</span>
                      </label>
                    </div>
                  )
                })}
              </div>
              <label className="field mt-3">Return reason
                <input required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Briefly explain why the item is being returned" />
                <span className="field-hint">This note is saved with the return for future reference.</span>
              </label>
              <label className="field mt-3">Refund method
                <select value={refundMethod} onChange={(event) => {
                  const method = paymentMethods.find((value) => value === event.target.value)
                  if (method) setRefundMethod(method)
                }}>
                  {paymentMethods.map((method) => <option value={method} key={method}>{methodLabels[method]}</option>)}
                </select>
                <span className="field-hint">Choose how the refund will be issued. Cash refunds require an open till.</span>
              </label>
              <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 font-semibold"><span>Estimated refund</span><span>{formatMoney(estimates.total)}</span></div>
              {estimates.error && <p className="mt-2 text-sm text-rose-700" role="alert">{estimates.error}</p>}
              <p className="mt-2 text-xs text-slate-500">The refund estimate reflects discounts already applied to the original sale.</p>
              <button className="button-primary mt-4 w-full" disabled={!window.shopApi || saving || !estimates.lines.length || Boolean(estimates.error)}>
                {saving ? 'Processing return…' : 'Record return & refund'}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-semibold">Return history</h2>
            <form className="mt-3 flex gap-2" onSubmit={(event) => void findReturns(event)}>
              <input aria-label="Search return history" placeholder="Return or sale invoice" value={returnSearch} onChange={(event) => setReturnSearch(event.target.value)} />
              <button type="submit" className="button-secondary" disabled={!window.shopApi}>Search</button>
            </form>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {returns.map((item) => (
              <li key={item.id}>
                <button className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50" onClick={() => void selectReturn(item)}>
                  <span><span className="block text-sm font-medium">{item.returnNumber}</span><span className="text-xs text-slate-500">{item.invoiceNumber} · {item.reason}</span></span>
                  <span className="text-sm font-semibold">{formatMoney(item.refundMinor)}</span>
                </button>
              </li>
            ))}
            {returns.length === 0 && <li className="py-4 text-sm text-slate-500">No returns found.</li>}
          </ul>
          {selectedReturn && (
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <div className="flex justify-between"><h3 className="font-semibold">{selectedReturn.returnNumber}</h3><button className="text-sm text-slate-500" onClick={() => setSelectedReturn(undefined)}>Close</button></div>
              <p className="mt-1 text-xs text-slate-500">{selectedReturn.invoiceNumber} · {selectedReturn.reason}</p>
              <ul className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm">
                {selectedReturn.items.map((item) => (
                  <li className="flex justify-between gap-3" key={`${selectedReturn.id}-${item.saleItemId}`}>
                    <span>{item.productName} × {formatQuantity(item.quantityMilli)}{item.restocked ? ' · restocked' : ' · not resalable'}</span>
                    <span>{formatMoney(item.refundMinor)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-slate-200 pt-3 text-sm font-semibold">Refund {formatMoney(selectedReturn.refundMinor)} · Cost reversal {formatMoney(selectedReturn.costReversalMinor)}</p>
            </div>
          )}
        </section>
      </div>
    </main>
    </LocalizeTree>
  )
}
