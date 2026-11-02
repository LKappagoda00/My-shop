import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Product } from '../../../../shared/catalog'
import type {
  PurchaseDetail,
  PurchaseDraftInput,
  PurchaseSummary,
  Supplier
} from '../../../../shared/procurement'
import { purchaseDraftInputSchema } from '../../../../shared/procurement'
import { paymentMethods } from '../../../../shared/sales'
import { roundMinorProduct } from '../../../../shared/financial'
import {
  formatMilliField,
  formatMinorField,
  formatMoney,
  formatQuantity,
  parseDecimalToScaled
} from '../../../../shared/precision'
import { confirmDelete, confirmReopenPurchase, LocalizeTree, useLocalization } from '../../localization'

interface DraftLine {
  productId: string
  quantityMilli: number
  unitCostMinor: number
}

interface PaymentAction {
  purchase: PurchaseDetail
  action: 'receive' | 'payment'
}

const methodLabels = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  qr: 'QR payment'
} as const

const unitLabels: Record<Product['unit'], string> = {
  piece: 'pieces',
  packet: 'packets',
  kg: 'kg',
  g: 'g',
  litre: 'litres',
  ml: 'ml'
}

function purchaseAmount(items: DraftLine[], additionalCostMinor: number): number {
  const total = items.reduce((sum, item) => (
    sum + BigInt(roundMinorProduct(item.unitCostMinor, item.quantityMilli))
  ), BigInt(additionalCostMinor))
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Purchase total exceeds the supported financial range')
  return Number(total)
}

export default function PurchasesPage() {
  const { language } = useLocalization()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([])
  const [search, setSearch] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [supplierInvoice, setSupplierInvoice] = useState('')
  const [additionalText, setAdditionalText] = useState('0.00')
  const [items, setItems] = useState<DraftLine[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [quantityText, setQuantityText] = useState('1.000')
  const [unitCostText, setUnitCostText] = useState('0.00')
  const [editingId, setEditingId] = useState<string>()
  const [paymentAction, setPaymentAction] = useState<PaymentAction>()
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number]>('cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.shopApi) return
    try {
      const [nextSuppliers, nextProducts, nextPurchases] = await Promise.all([
        window.shopApi.listSuppliers(),
        window.shopApi.listProducts(),
        window.shopApi.listPurchases(search)
      ])
      setSuppliers(nextSuppliers)
      setProducts(nextProducts)
      setPurchases(nextPurchases)
      if (!supplierId && nextSuppliers.length) setSupplierId(nextSuppliers[0].id)
      if (!selectedProductId && nextProducts.length) {
        setSelectedProductId(nextProducts[0].id)
        setUnitCostText(formatMinorField(nextProducts[0].costPriceMinor))
      }
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [search, selectedProductId, supplierId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeProducts = products.filter((product) => !product.archived)
  const activeSuppliers = suppliers.filter((supplier) => !supplier.archived)

  const total = useMemo(() => {
    try {
      const additional = parseDecimalToScaled(additionalText, 2)
      return { amount: purchaseAmount(items, additional), error: '' }
    } catch (totalError) {
      return { amount: 0, error: totalError instanceof Error ? totalError.message : String(totalError) }
    }
  }, [additionalText, items])

  function changeProduct(productId: string) {
    setSelectedProductId(productId)
    const product = products.find((item) => item.id === productId)
    if (product) setUnitCostText(formatMinorField(product.costPriceMinor))
  }

  function addLine() {
    setError('')
    try {
      if (!selectedProductId) throw new Error('Select a product')
      if (items.some((item) => item.productId === selectedProductId)) {
        throw new Error('A product can appear only once in a purchase')
      }
      const quantityMilli = parseDecimalToScaled(quantityText, 3)
      const unitCostMinor = parseDecimalToScaled(unitCostText, 2)
      if (quantityMilli <= 0) throw new Error('Purchase quantity must be greater than zero')
      setItems((current) => [...current, { productId: selectedProductId, quantityMilli, unitCostMinor }])
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError))
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    let additionalCostsMinor: number
    try {
      additionalCostsMinor = parseDecimalToScaled(additionalText, 2)
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError))
      return
    }
    const parsed = purchaseDraftInputSchema.safeParse({
      supplierId,
      supplierInvoiceNumber: supplierInvoice,
      additionalCostsMinor,
      items
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check purchase details.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const input: PurchaseDraftInput = parsed.data
      const saved = editingId
        ? await window.shopApi.updatePurchaseDraft(editingId, input)
        : await window.shopApi.createPurchaseDraft(input)
      setEditingId(undefined)
      setItems([])
      setSupplierInvoice('')
      setAdditionalText('0.00')
      setPaymentAction({ purchase: saved, action: 'receive' })
      setPaymentAmount(formatMinorField(saved.totalCostMinor))
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function editDraft(purchase: PurchaseSummary) {
    if (!window.shopApi) return
    try {
      const detail = await window.shopApi.getPurchase(purchase.id)
      if (!detail) throw new Error(`Purchase ${purchase.purchaseNumber} could not be found`)
      setEditingId(detail.id)
      setSupplierId(detail.supplierId)
      setSupplierInvoice(detail.supplierInvoiceNumber ?? '')
      setAdditionalText(formatMinorField(detail.additionalCostsMinor))
      setItems(detail.items.map((item) => ({
        productId: item.productId,
        quantityMilli: item.quantityMilli,
        unitCostMinor: item.unitCostMinor
      })))
      setPaymentAction(undefined)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }

  async function openPaymentAction(purchase: PurchaseSummary, action: PaymentAction['action']) {
    if (!window.shopApi) return
    try {
      const detail = await window.shopApi.getPurchase(purchase.id)
      if (!detail) throw new Error(`Purchase ${purchase.purchaseNumber} could not be found`)
      setPaymentAction({ purchase: detail, action })
      setPaymentAmount(formatMinorField(action === 'receive' ? detail.totalCostMinor : detail.balanceMinor))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }

  async function submitPaymentAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi || !paymentAction) return
    let amountMinor: number
    try {
      amountMinor = parseDecimalToScaled(paymentAmount, 2)
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError))
      return
    }
    setSaving(true)
    setError('')
    try {
      if (paymentAction.action === 'receive') {
        await window.shopApi.receivePurchase({
          id: paymentAction.purchase.id,
          payments: amountMinor > 0
            ? [{ method: paymentMethod, amountMinor, reference: paymentReference }]
            : []
        })
      } else {
        if (amountMinor <= 0) throw new Error('Payment amount must be greater than zero')
        await window.shopApi.recordSupplierPayment({
          purchaseId: paymentAction.purchase.id,
          method: paymentMethod,
          amountMinor,
          reference: paymentReference
        })
      }
      setPaymentAction(undefined)
      setPaymentReference('')
      await refresh()
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : String(paymentError))
    } finally {
      setSaving(false)
    }
  }

  async function cancelDraft(purchase: PurchaseSummary) {
    if (!window.shopApi || !confirmDelete(purchase.purchaseNumber, language, 'draft')) return
    try {
      await window.shopApi.cancelPurchaseDraft(purchase.id)
      await refresh()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError))
    }
  }

  async function reopenCancelledPurchase(purchase: PurchaseSummary) {
    if (!window.shopApi || !confirmReopenPurchase(purchase.purchaseNumber, language)) return
    try {
      const reopened = await window.shopApi.reopenCancelledPurchase(purchase.id)
      setPaymentAction({ purchase: reopened, action: 'receive' })
      setPaymentAmount(formatMinorField(reopened.totalCostMinor))
      setError('')
      await refresh()
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : String(reopenError))
    }
  }

  return (
    <LocalizeTree>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div><h2 className="text-lg font-semibold">Purchase history</h2><p className="mt-1 text-sm text-slate-500">Stock is added only when a draft is received.</p></div>
          <input aria-label="Search purchases" className="w-56" placeholder="Purchase or supplier invoice" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {error && <p className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
        <div className="divide-y divide-slate-100">
          {purchases.map((purchase) => (
            <div className="p-5" key={purchase.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{purchase.purchaseNumber}<span className="ml-2 text-xs font-normal text-slate-500">{purchase.status}</span></p>
                  <p className="mt-1 text-sm text-slate-600">{purchase.supplierName}{purchase.supplierInvoiceNumber ? ` · Invoice ${purchase.supplierInvoiceNumber}` : ''}</p>
                  <p className="mt-1 text-xs text-slate-500">{purchase.createdAt.slice(0, 10)} · Paid {formatMoney(purchase.amountPaidMinor)} · Balance {formatMoney(purchase.balanceMinor)}</p>
                </div>
                <strong className="text-sm">{formatMoney(purchase.totalCostMinor)}</strong>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {purchase.status === 'draft' && <>
                  <button className="text-xs font-semibold text-emerald-700" onClick={() => void editDraft(purchase)}>Edit draft</button>
                  <button className="text-xs font-semibold text-emerald-700" onClick={() => void openPaymentAction(purchase, 'receive')}>Receive stock</button>
                  <button className="text-xs font-semibold text-rose-700" onClick={() => void cancelDraft(purchase)}>Delete draft</button>
                </>}
                {purchase.status === 'received' && purchase.balanceMinor > 0 && (
                  <button className="text-xs font-semibold text-emerald-700" onClick={() => void openPaymentAction(purchase, 'payment')}>Record supplier payment</button>
                )}
                {purchase.status === 'cancelled' && (
                  <button className="text-xs font-semibold text-emerald-700" onClick={() => void reopenCancelledPurchase(purchase)}>Reopen cancelled draft</button>
                )}
              </div>
            </div>
          ))}
          {purchases.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No purchases found.</p>}
        </div>
      </section>

      <div className="grid gap-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">{editingId ? 'Edit purchase draft' : 'Create purchase draft'}</h2>
            <p className="mt-1 text-sm text-slate-500">Prepare the supplier invoice here. Inventory changes only after you confirm receipt.</p>
          </div>
          <form className="grid gap-4" onSubmit={(event) => void saveDraft(event)}>
            <label className="field">Supplier
              <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
                <option value="">Select supplier</option>
                {activeSuppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}
              </select>
              <span className="field-hint">Choose the supplier responsible for this delivery.</span>
            </label>
            <label className="field">Supplier invoice number
              <input value={supplierInvoice} onChange={(event) => setSupplierInvoice(event.target.value)} maxLength={100} placeholder="Optional reference from the supplier" />
              <span className="field-hint">Enter the reference printed on the supplier’s invoice, if available.</span>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_100px] items-end gap-2">
              <label className="field">Product
                <select value={selectedProductId} onChange={(event) => changeProduct(event.target.value)}>
                  {activeProducts.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.sku}</option>)}
                </select>
                <span className="field-hint">Select an existing catalog product.</span>
              </label>
              <label className="field">Quantity
                <input inputMode="decimal" value={quantityText} onChange={(event) => setQuantityText(event.target.value)} />
                <span className="field-hint">Delivered quantity.</span>
              </label>
            </div>
            {selectedProductId && <p className="-mt-3 text-xs text-slate-500">Quantity is measured in {unitLabels[products.find((product) => product.id === selectedProductId)?.unit ?? 'piece']}.</p>}
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <label className="field">Unit cost (LKR)
                <input inputMode="decimal" value={unitCostText} onChange={(event) => setUnitCostText(event.target.value)} placeholder="0.00" />
                <span className="field-hint">Supplier’s cost per selected unit before landed costs.</span>
              </label>
              <button type="button" className="button-secondary" onClick={addLine} aria-label="Add product to purchase">Add item</button>
            </div>
            {items.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 px-3">
                {items.map((item) => {
                  const product = products.find((candidate) => candidate.id === item.productId)
                  return (
                    <li key={item.productId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>{product?.name ?? item.productId} × {formatQuantity(item.quantityMilli)}</span>
                      <span className="flex items-center gap-2">{formatMoney(roundMinorProduct(item.unitCostMinor, item.quantityMilli))}
                        <button type="button" aria-label={`Remove ${product?.name ?? 'purchase item'}`} className="text-rose-700" onClick={() => setItems((current) => current.filter((entry) => entry.productId !== item.productId))}>×</button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <label className="field">Additional landed costs (LKR)
              <input inputMode="decimal" value={additionalText} onChange={(event) => setAdditionalText(event.target.value)} placeholder="0.00" />
              <span className="field-hint">Include freight or handling costs. These are allocated across received products.</span>
            </label>
            {total.error && <p className="text-sm text-rose-700" role="alert">{total.error}</p>}
            <div className="flex justify-between border-t border-slate-100 pt-3 font-semibold"><span>Estimated purchase total</span><span>{formatMoney(total.amount)}</span></div>
            <div className="flex gap-2">
              <button type="submit" className="button-primary flex-1" disabled={!window.shopApi || saving || activeSuppliers.length === 0 || !items.length || Boolean(total.error)}>{saving ? 'Saving…' : editingId ? 'Save draft' : 'Create draft'}</button>
              {editingId && <button type="button" className="button-secondary" onClick={() => { setEditingId(undefined); setItems([]) }}>Cancel edit</button>}
            </div>
          </form>
        </section>

        {paymentAction && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
            <h2 className="text-lg font-semibold">{paymentAction.action === 'receive' ? 'Receive purchase' : 'Pay supplier balance'}</h2>
            <p className="mt-1 text-sm text-slate-600">{paymentAction.purchase.purchaseNumber} · {paymentAction.purchase.supplierName}</p>
            <p className="mt-1 text-sm text-slate-500">{paymentAction.action === 'receive'
              ? 'Confirm the delivered goods and record any payment made now. Stock and weighted-average cost update together.'
              : 'Record a payment against the outstanding balance for this purchase.'}</p>
            <form className="mt-4 grid gap-3" onSubmit={(event) => void submitPaymentAction(event)}>
              <label className="field">Payment now (LKR)
                <input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" />
                <span className="field-hint">{paymentAction.action === 'receive'
                  ? `Total invoice: ${formatMoney(paymentAction.purchase.totalCostMinor)}. Enter 0.00 if no payment is made now.`
                  : `Outstanding balance: ${formatMoney(paymentAction.purchase.balanceMinor)}.`}</span>
              </label>
              <label className="field">Payment method
                <select value={paymentMethod} onChange={(event) => {
                  const method = paymentMethods.find((value) => value === event.target.value)
                  if (method) setPaymentMethod(method)
                }}>
                  {paymentMethods.map((method) => <option key={method} value={method}>{methodLabels[method]}</option>)}
                </select>
                <span className="field-hint">Select the method used for this supplier payment.</span>
              </label>
              <label className="field">Reference (optional)
                <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={160} placeholder="Transaction or receipt number" />
                <span className="field-hint">Add a bank reference, receipt number, or other payment identifier.</span>
              </label>
              <div className="flex gap-2">
                <button className="button-primary flex-1" disabled={saving}>{paymentAction.action === 'receive' ? 'Confirm receipt' : 'Record payment'}</button>
                <button type="button" className="button-secondary" onClick={() => setPaymentAction(undefined)}>Close</button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
    </LocalizeTree>
  )
}
