import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { Product } from '../../../../shared/catalog'
import type { HeldSale, SaleDetail, SaleInput, SaleSummary } from '../../../../shared/sales'
import type { CashStatus } from '../../../../shared/cash'
import { calculateSaleTotals } from '../../../../shared/sales'
import {
  formatMilliField,
  formatMoney,
  formatQuantity,
  parseDecimalToScaled
} from '../../../../shared/precision'
import { paymentMethods } from '../../../../shared/sales'
import { confirmDelete, LocalizeTree, useLocalization } from '../../localization'

interface CartLine {
  productId: string
  quantityMilli: number
  lineDiscountMinor: number
}

const unitLabels: Record<Product['unit'], string> = {
  piece: 'pieces',
  packet: 'packets',
  kg: 'kg',
  g: 'g',
  litre: 'litres',
  ml: 'ml'
}

function paymentLabel(method: SaleDetail['payments'][number]['method']): string {
  return ({
    cash: 'Cash',
    card: 'Card',
    bank_transfer: 'Bank transfer',
    qr: 'QR payment'
  })[method]
}

function printReceipt(): void {
  const cleanup = () => document.body.classList.remove('printing-receipt')
  document.body.classList.add('printing-receipt')
  window.addEventListener('afterprint', cleanup, { once: true })
  window.print()
}

interface CartLineRowProps {
  line: CartLine
  product: Product
  onChange: (line: CartLine) => void
  onValidityChange: (valid: boolean) => void
  onRemove: () => void
}

function CartLineRow({ line, product, onChange, onValidityChange, onRemove }: CartLineRowProps) {
  const [quantityText, setQuantityText] = useState(formatMilliField(line.quantityMilli))
  const [discountText, setDiscountText] = useState(formatMoney(line.lineDiscountMinor).replace(/^LKR /, ''))
  const [draftError, setDraftError] = useState('')
  const [quantityValid, setQuantityValid] = useState(true)
  const [discountValid, setDiscountValid] = useState(true)

  useEffect(() => {
    setQuantityText(formatMilliField(line.quantityMilli))
    setDiscountText(formatMoney(line.lineDiscountMinor).replace(/^LKR /, ''))
  }, [line.quantityMilli, line.lineDiscountMinor])

  function updateQuantity(value: string) {
    setQuantityText(value)
    try {
      const quantityMilli = parseDecimalToScaled(value, 3)
      if (quantityMilli <= 0) throw new Error('Quantity must be greater than zero')
      setQuantityValid(true)
      setDraftError('')
      onValidityChange(discountValid)
      onChange({ ...line, quantityMilli })
    } catch (error) {
      setQuantityValid(false)
      setDraftError(error instanceof Error ? error.message : String(error))
      onValidityChange(false)
    }
  }

  function updateDiscount(value: string) {
    setDiscountText(value)
    try {
      const lineDiscountMinor = parseDecimalToScaled(value, 2)
      setDiscountValid(true)
      setDraftError('')
      onValidityChange(quantityValid)
      onChange({ ...line, lineDiscountMinor })
    } catch (error) {
      setDiscountValid(false)
      setDraftError(error instanceof Error ? error.message : String(error))
      onValidityChange(false)
    }
  }

  return (
    <LocalizeTree>
    <div className="grid grid-cols-[minmax(0,1fr)_92px_104px_auto] items-center gap-3 border-b border-slate-100 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p className="mt-1 text-xs text-slate-500">{formatMoney(product.sellingPriceMinor)} per {unitLabels[product.unit]}</p>
      </div>
      <label className="field text-xs">Quantity
        <input aria-label={`${product.name} quantity`} inputMode="decimal" aria-invalid={Boolean(draftError)} value={quantityText} onChange={(event) => updateQuantity(event.target.value)} onBlur={() => {
          setQuantityText(formatMilliField(line.quantityMilli))
          setQuantityValid(true)
          setDiscountValid(true)
          setDiscountText(formatMoney(line.lineDiscountMinor).replace(/^LKR /, ''))
          setDraftError('')
          onValidityChange(true)
        }} />
        <span className="field-hint">Up to 3 decimals.</span>
      </label>
      <label className="field text-xs">Discount (LKR)
        <input aria-label={`${product.name} discount`} inputMode="decimal" aria-invalid={Boolean(draftError)} value={discountText} onChange={(event) => updateDiscount(event.target.value)} onBlur={() => {
          setQuantityText(formatMilliField(line.quantityMilli))
          setDiscountText(formatMoney(line.lineDiscountMinor).replace(/^LKR /, ''))
          setQuantityValid(true)
          setDiscountValid(true)
          setDraftError('')
          onValidityChange(true)
        }} />
        <span className="field-hint">Optional item discount.</span>
      </label>
      <button className="px-2 py-1 text-sm text-slate-400 hover:text-rose-700" aria-label={`Remove ${product.name}`} onClick={onRemove}>×</button>
      {draftError && <p className="col-span-4 -mt-2 text-xs text-rose-700" role="alert">{draftError}</p>}
    </div>
    </LocalizeTree>
  )
}

export default function PosPage() {
  const { language } = useLocalization()
  const [products, setProducts] = useState<Product[]>([])
  const [cashStatus, setCashStatus] = useState<CashStatus>({ current: null, today: null })
  const [cart, setCart] = useState<CartLine[]>([])
  const [invalidCartLines, setInvalidCartLines] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [billDiscountText, setBillDiscountText] = useState('0.00')
  const [paymentMethod, setPaymentMethod] = useState<SaleInput['payments'][number]['method']>('cash')
  const [cashReceivedText, setCashReceivedText] = useState('')
  const [salesSearch, setSalesSearch] = useState('')
  const [sales, setSales] = useState<SaleSummary[]>([])
  const [heldSales, setHeldSales] = useState<HeldSale[]>([])
  const [activeHeldSaleId, setActiveHeldSaleId] = useState<string>()
  const [selectedSale, setSelectedSale] = useState<SaleDetail>()
  const [voidReason, setVoidReason] = useState('')
  const [voidSaving, setVoidSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const checkoutRef = useRef<HTMLFormElement>(null)

  const refreshProducts = useCallback(async () => {
    if (!window.shopApi) {
      setLoading(false)
      return
    }
    try {
      const [nextProducts, recentSales, nextCashStatus, nextHeldSales] = await Promise.all([
        window.shopApi.listProducts('', false),
        window.shopApi.listSales(salesSearch),
        window.shopApi.getCashStatus(),
        window.shopApi.listHeldSales()
      ])
      setProducts(nextProducts)
      setSales(recentSales)
      setCashStatus(nextCashStatus)
      setHeldSales(nextHeldSales)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [salesSearch])

  useEffect(() => {
    void refreshProducts()
  }, [refreshProducts])

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'F2') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'F4') {
        event.preventDefault()
        checkoutRef.current?.requestSubmit()
      } else if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    if (!needle) return products.filter((product) => !product.archived)
    return products.filter((product) => !product.archived
      && [product.name, product.sku, product.barcode ?? ''].some((value) => value.toLocaleLowerCase().includes(needle)))
  }, [products, search])

  const totalsResult = useMemo(() => {
    try {
      const lineProducts = cart.map((line) => {
        const product = productById.get(line.productId)
        if (!product) throw new Error('A product in the cart is no longer available')
        return product
      })
      const billDiscountMinor = parseDecimalToScaled(billDiscountText, 2)
      return {
        totals: calculateSaleTotals(lineProducts, cart, billDiscountMinor),
        error: ''
      }
    } catch (calculationError) {
      return {
        totals: undefined,
        error: calculationError instanceof Error ? calculationError.message : String(calculationError)
      }
    }
  }, [billDiscountText, cart, productById])

  const totals = totalsResult.totals
  const totalDueMinor = totals?.netSalesMinor ?? 0
  const cashReceivedMinor = useMemo(() => {
    try {
      return parseDecimalToScaled(cashReceivedText || '0.00', 2)
    } catch {
      return -1
    }
  }, [cashReceivedText])
  const availableStock = cart.every((line) => {
    const product = productById.get(line.productId)
    return product !== undefined && line.quantityMilli <= product.stockOnHandMilli
  })
  const paymentValid = paymentMethod === 'cash'
    ? cashReceivedMinor >= totalDueMinor
    : totalDueMinor > 0
  const cashSessionValid = paymentMethod !== 'cash' || cashStatus.current !== null
  const hasInvalidCartDraft = Object.values(invalidCartLines).some((valid) => !valid)
  const checkoutEnabled = Boolean(window.shopApi && totals && totalDueMinor > 0 && cart.length && availableStock && paymentValid && cashSessionValid && !hasInvalidCartDraft && !saving)

  useEffect(() => {
    if (paymentMethod === 'cash') setCashReceivedText(formatMoney(totalDueMinor).replace(/^LKR /, ''))
  }, [paymentMethod, totalDueMinor])

  function setCartLineValidity(productId: string, valid: boolean) {
    setInvalidCartLines((current) => ({ ...current, [productId]: valid }))
  }

  function addProduct(product: Product) {
    setError('')
    setNotice('')
    if (product.stockOnHandMilli <= 0) {
      setError(`${product.name} is out of stock`)
      return
    }
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id)
      if (!existing) return [...current, { productId: product.id, quantityMilli: 1000, lineDiscountMinor: 0 }]
      if (existing.quantityMilli + 1000 > product.stockOnHandMilli) {
        setError(`Not enough stock for ${product.name}`)
        return current
      }
      return current.map((line) => line.productId === product.id
        ? { ...line, quantityMilli: line.quantityMilli + 1000 }
        : line)
    })
    setSearch('')
    searchRef.current?.focus()
  }

  function scanOrSearch(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !search.trim()) return
    event.preventDefault()
    const needle = search.trim().toLocaleLowerCase()
    const exact = products.find((product) => !product.archived
      && (product.sku.toLocaleLowerCase() === needle || product.barcode?.toLocaleLowerCase() === needle))
    if (exact) addProduct(exact)
  }

  async function completeSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const api = window.shopApi
    if (!api || !totals || !cart.length || !checkoutEnabled) return
    setError('')
    setNotice('')
    setSaving(true)
    try {
      const input: SaleInput = {
        idempotencyKey: crypto.randomUUID(),
        ...(activeHeldSaleId ? { heldSaleId: activeHeldSaleId } : {}),
        billDiscountMinor: totals.billDiscountMinor,
        lines: cart,
        payments: [{
          method: paymentMethod,
          amountMinor: totalDueMinor,
          ...(paymentMethod === 'cash' ? { amountReceivedMinor: cashReceivedMinor } : {})
        }]
      }
      const sale = await api.createSale(input)
      setCart([])
      setInvalidCartLines({})
      setBillDiscountText('0.00')
      setActiveHeldSaleId(undefined)
      setSelectedSale(sale)
      setNotice(`Sale saved locally · ${sale.invoiceNumber}`)
      await refreshProducts()
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : String(checkoutError))
      await refreshProducts()
    } finally {
      setSaving(false)
    }
  }

  async function holdCurrentSale() {
    if (!window.shopApi || !totals || !cart.length || hasInvalidCartDraft) return
    setError('')
    setNotice('')
    setSaving(true)
    const id = activeHeldSaleId ?? crypto.randomUUID()
    try {
      const heldAt = language === 'si'
        ? new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Colombo'
          })
        : new Intl.DateTimeFormat('en-LK', {
            timeZone: 'Asia/Colombo',
            dateStyle: 'short',
            timeStyle: 'short'
          })
      await window.shopApi.saveHeldSale({
        id,
        title: `Held ${heldAt.format(new Date())}`,
        billDiscountMinor: totals.billDiscountMinor,
        lines: cart
      })
      setCart([])
      setInvalidCartLines({})
      setBillDiscountText('0.00')
      setActiveHeldSaleId(undefined)
      setNotice('Sale held locally and is ready to resume.')
      await refreshProducts()
    } catch (holdError) {
      setError(holdError instanceof Error ? holdError.message : String(holdError))
    } finally {
      setSaving(false)
    }
  }

  function resumeHeldSale(heldSale: HeldSale) {
    if (cart.length && !window.confirm('Replace the current cart? Unsaved cart changes will be lost.')) return
    const unavailable = heldSale.lines.find((line) => !productById.has(line.productId))
    if (unavailable) {
      setError('This held sale contains an archived or unavailable product and cannot be resumed.')
      return
    }
    setError('')
    setNotice(`${heldSale.title} resumed.`)
    setCart(heldSale.lines.map((line) => ({ ...line })))
    setInvalidCartLines({})
    setBillDiscountText(formatMoney(heldSale.billDiscountMinor).replace(/^LKR /, ''))
    setActiveHeldSaleId(heldSale.id)
  }

  async function deleteHeldSale(heldSale: HeldSale) {
    if (!window.shopApi || !confirmDelete(heldSale.title, language, 'permanent')) return
    try {
      await window.shopApi.deleteHeldSale(heldSale.id)
      if (activeHeldSaleId === heldSale.id) setActiveHeldSaleId(undefined)
      await refreshProducts()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  async function voidSelectedSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi || !selectedSale || selectedSale.status !== 'completed' || voidSaving) return
    if (!window.confirm(`Void invoice ${selectedSale.invoiceNumber}? This restores inventory and refunds the original payments.`)) return
    setVoidSaving(true)
    setError('')
    try {
      const voided = await window.shopApi.voidSale({ id: selectedSale.id, reason: voidReason })
      setSelectedSale(voided)
      setVoidReason('')
      setNotice(`Invoice ${voided.invoiceNumber} voided and recorded.`)
      await refreshProducts()
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : String(voidError))
    } finally {
      setVoidSaving(false)
    }
  }

  async function openSale(sale: SaleSummary) {
    if (!window.shopApi) return
    try {
      const detail = await window.shopApi.getSale(sale.id)
      if (!detail) throw new Error(`Sale ${sale.invoiceNumber} could not be found`)
      setSelectedSale(detail)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }

  async function searchSales(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await refreshProducts()
  }

  return (
    <LocalizeTree>
    <main className="mx-auto max-w-[1500px] px-6 py-8">
      {!window.shopApi && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Browser preview only. Offline checkout requires the Electron desktop app and its local database.
        </div>
      )}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-700">CHECKOUT</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Point of sale</h1>
          <p className="mt-2 text-sm text-slate-500">Scan a barcode or search the catalog, review the cart, and complete payment.</p>
        </div>
        <p className="text-xs text-slate-500">F2 search · F4 checkout · Esc clear search</p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{notice}</div>}
      {window.shopApi && paymentMethod === 'cash' && !cashSessionValid && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Open today’s cash session from Cash management before accepting a cash payment.
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-5">
            <label className="field">Find a product
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={scanOrSearch}
                placeholder="Search by product name, SKU, or scan barcode"
                autoFocus
              />
              <span className="field-hint">Press Enter after scanning a barcode or SKU to add the matching product.</span>
            </label>
          </div>
          <div className="max-h-[570px] overflow-y-auto p-3">
            {loading && <p className="p-6 text-center text-sm text-slate-500">Loading products…</p>}
            {!loading && filteredProducts.length === 0 && (
              <p className="p-8 text-center text-sm text-slate-500">{search ? 'No matching products found.' : 'No products are available for sale.'}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {filteredProducts.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  onClick={() => addProduct(product)}
                  disabled={product.stockOnHandMilli <= 0}
                  className="rounded-xl border border-slate-200 p-4 text-left hover:border-emerald-300 hover:bg-emerald-50/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="block truncate text-sm font-semibold">{product.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">{product.sku} · {formatQuantity(product.stockOnHandMilli)} {unitLabels[product.unit]} available</span>
                  <span className="mt-3 block text-sm font-semibold text-emerald-800">{formatMoney(product.sellingPriceMinor)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-6">
          <form ref={checkoutRef} onSubmit={completeSale} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Current sale</h2>
                <p className="mt-1 text-sm text-slate-500">{cart.length} distinct items</p>
              </div>
              {cart.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
                    type="button"
                    onClick={() => void holdCurrentSale()}
                    disabled={!window.shopApi || !totals || hasInvalidCartDraft || saving}
                  >Hold sale</button>
                  <button className="text-sm font-medium text-slate-500 hover:text-rose-700" type="button" onClick={() => {
                    setCart([])
                    setInvalidCartLines({})
                    setActiveHeldSaleId(undefined)
                  }}>Clear cart</button>
                </div>
              )}
            </div>

            {cart.length === 0 ? (
              <p className="my-8 text-center text-sm text-slate-500">Add a product to begin checkout.</p>
            ) : (
              <div className="mt-3">
                {cart.map((line) => {
                  const product = productById.get(line.productId)
                  if (!product) return null
                  return <CartLineRow
                    key={line.productId}
                    line={line}
                    product={product}
                    onChange={(next) => setCart((current) => current.map((item) => item.productId === next.productId ? next : item))}
                    onValidityChange={(valid) => setCartLineValidity(line.productId, valid)}
                    onRemove={() => {
                      setCart((current) => current.filter((item) => item.productId !== line.productId))
                      setInvalidCartLines((current) => {
                        const next = { ...current }
                        delete next[line.productId]
                        return next
                      })
                    }}
                  />
                })}
              </div>
            )}

            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <label className="field">Bill discount (LKR)
                <input inputMode="decimal" value={billDiscountText} onChange={(event) => setBillDiscountText(event.target.value)} onBlur={() => {
                  try { setBillDiscountText(formatMoney(parseDecimalToScaled(billDiscountText, 2)).replace(/^LKR /, '')) } catch { setBillDiscountText('0.00') }
                }} />
                <span className="field-hint">Optional discount applied across the whole sale.</span>
              </label>
              <label className="field">Payment method
                <select value={paymentMethod} onChange={(event) => {
                  const method = paymentMethods.find((value) => value === event.target.value)
                  if (method) setPaymentMethod(method)
                }}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="qr">QR payment</option>
                </select>
                <span className="field-hint">Select the tender used to settle this sale.</span>
              </label>
              {paymentMethod === 'cash' && (
                <label className="field sm:col-span-2">Cash received (LKR)
                  <input inputMode="decimal" value={cashReceivedText} onChange={(event) => setCashReceivedText(event.target.value)} />
                  <span className="field-hint">Enter the amount received. Change due is calculated automatically.</span>
                </label>
              )}
            </div>

            <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm">
              <div className="flex justify-between text-slate-600"><span>Gross sales</span><span>{formatMoney(totals?.grossSalesMinor ?? 0)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Item discounts</span><span>− {formatMoney(totals?.lineDiscountsMinor ?? 0)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Bill discount</span><span>− {formatMoney(totals?.billDiscountMinor ?? 0)}</span></div>
              <div className="flex justify-between border-t border-slate-100 pt-3 text-lg font-semibold"><span>Total due</span><span>{formatMoney(totalDueMinor)}</span></div>
              {paymentMethod === 'cash' && cashReceivedMinor >= totalDueMinor && totalDueMinor > 0 && (
                <div className="flex justify-between font-medium text-emerald-800"><span>Change</span><span>{formatMoney(cashReceivedMinor - totalDueMinor)}</span></div>
              )}
            </div>

            {totalsResult.error && cart.length > 0 && <p className="mt-3 text-sm text-rose-700" role="alert">{totalsResult.error}</p>}
            {!availableStock && <p className="mt-3 text-sm text-rose-700" role="alert">Cart quantity exceeds current stock.</p>}
            {paymentMethod === 'cash' && cashReceivedMinor >= 0 && cashReceivedMinor < totalDueMinor && (
              <p className="mt-3 text-sm text-rose-700" role="alert">Cash received is less than the amount due.</p>
            )}
                  {hasInvalidCartDraft && <p className="mt-3 text-sm text-rose-700" role="alert">Correct invalid quantity or discount fields before checkout.</p>}
                  <button type="submit" className="button-primary mt-5 w-full py-3 text-base" disabled={!checkoutEnabled}>
              {saving ? 'Saving sale…' : 'Complete checkout'}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">The sale, payment, and stock update are saved together to this device.</p>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">Held sales</h2>
              <p className="mt-1 text-sm text-slate-500">Saved carts persist locally until checked out or deleted.</p>
              <div className="mt-3 divide-y divide-slate-100">
                {heldSales.map((heldSale) => (
                  <div key={heldSale.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{heldSale.title}</p>
                      <p className="text-xs text-slate-500">{heldSale.lines.length} items · Updated {new Date(heldSale.updatedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex shrink-0 gap-3">
                      <button type="button" className="text-xs font-medium text-emerald-700" onClick={() => resumeHeldSale(heldSale)}>Resume</button>
                      <button type="button" className="text-xs font-medium text-rose-700" onClick={() => void deleteHeldSale(heldSale)}>Delete</button>
                    </div>
                  </div>
                ))}
                {heldSales.length === 0 && <p className="py-4 text-sm text-slate-500">No held sales.</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Sales history</h2>
                <p className="mt-1 text-sm text-slate-500">Recent saved invoices</p>
              </div>
              <form className="flex gap-2" onSubmit={(event) => void searchSales(event)}>
                <input aria-label="Search sales by invoice" placeholder="Invoice number" value={salesSearch} onChange={(event) => setSalesSearch(event.target.value)} />
                <button className="button-secondary" type="submit">Search</button>
              </form>
            </div>
            <div className="mt-4 divide-y divide-slate-100">
              {sales.slice(0, 5).map((sale) => (
                <button key={sale.id} type="button" onClick={() => void openSale(sale)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50">
                  <span><span className="block text-sm font-medium">{sale.invoiceNumber}</span><span className="text-xs text-slate-500">{sale.businessDate}</span></span>
                  <span className="text-sm font-semibold">{formatMoney(sale.netSalesMinor)}</span>
                </button>
              ))}
              {sales.length === 0 && <p className="py-5 text-sm text-slate-500">No saved sales found.</p>}
            </div>
            {selectedSale && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <div className="no-print mb-4 flex justify-end gap-3">
                  <button type="button" className="text-sm font-medium text-emerald-700" onClick={printReceipt}>Print receipt</button>
                  <button className="text-sm text-slate-500 hover:text-slate-900" onClick={() => setSelectedSale(undefined)} aria-label="Close sale details">Close</button>
                </div>
                <div className="receipt-print">
                  <header className="mb-3 border-b border-dashed border-slate-400 pb-3 text-center">
                    <h3 className="text-lg font-bold">My Shop</h3>
                    <p className="text-xs">Sales receipt</p>
                    {selectedSale.status === 'voided' && <p className="mt-2 font-bold">VOIDED</p>}
                  </header>
                  <div className="flex justify-between gap-2 text-xs">
                    <span>Invoice</span><strong>{selectedSale.invoiceNumber}</strong>
                  </div>
                  <div className="mt-1 flex justify-between gap-2 text-xs">
                    <span>Date</span><span>{selectedSale.businessDate}</span>
                  </div>
                  <ul className="mt-3 space-y-2 border-y border-dashed border-slate-400 py-3 text-xs">
                    {selectedSale.items.map((item) => (
                      <li key={`${selectedSale.id}-${item.productId}`} className="flex justify-between gap-3">
                        <span>{item.productName} × {formatQuantity(item.quantityMilli)}</span><span>{formatMoney(item.netLineMinor)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 flex justify-between text-sm font-bold">
                    <span>Total</span><span>{formatMoney(selectedSale.netSalesMinor)}</span>
                  </p>
                  <p className="mt-2 text-xs font-semibold">Payments</p>
                  {(selectedSale.status === 'voided' ? selectedSale.voidPayments : selectedSale.payments).map((payment, index) => (
                    <p className="mt-1 flex justify-between text-xs" key={`${payment.method}-${index}`}>
                      <span>{selectedSale.status === 'voided' ? 'Refund' : paymentLabel(payment.method)}</span>
                      <span>{paymentLabel(payment.method)} {formatMoney(payment.amountMinor)}</span>
                    </p>
                  ))}
                  {selectedSale.payments.some((payment) => payment.changeMinor > 0) && selectedSale.status !== 'voided' && (
                    <p className="mt-1 flex justify-between text-xs">
                      <span>Change</span>
                      <span>{formatMoney(selectedSale.payments.reduce((sum, payment) => sum + payment.changeMinor, 0))}</span>
                    </p>
                  )}
                  {selectedSale.voidReason && <p className="mt-3 text-xs">Void reason: {selectedSale.voidReason}</p>}
                  <p className="mt-4 text-center text-xs">Thank you for shopping with us.</p>
                </div>
                {selectedSale.status === 'completed' && (
                  <form className="no-print mt-4 border-t border-slate-200 pt-4" onSubmit={(event) => void voidSelectedSale(event)}>
                    <label className="field">Void sale (refunds original tenders and restores stock)
                      <input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required maxLength={300} placeholder="Reason for voiding this invoice" />
                    </label>
                    <button className="button-secondary mt-2 text-rose-700" type="submit" disabled={voidSaving || !voidReason.trim()}>
                      {voidSaving ? 'Voiding…' : 'Void invoice'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
    </LocalizeTree>
  )
}
