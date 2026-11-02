import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  categoryInputSchema,
  productInputSchema,
  productUpdateSchema,
  stockAdjustmentSchema,
  type Category,
  type CategoryInput,
  type Product,
  type ProductInput,
  type ProductUpdate,
  type StockMovement,
  type StockReconciliationInput,
  type StockAdjustmentInput
} from '../../../../shared/catalog'
import { parseCsv } from '../../../../shared/csv'
import {
  formatMilliField,
  formatMoney,
  formatMinorField,
  formatQuantity,
  parseDecimalToScaled
} from '../../../../shared/precision'
import { confirmDelete, LocalizeTree, useLocalization } from '../../localization'

const unitLabels: Record<Product['unit'], string> = {
  piece: 'pieces',
  packet: 'packets',
  kg: 'kg',
  g: 'g',
  litre: 'litres',
  ml: 'ml'
}

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? 'Check the entered values and try again.'
}

const productCsvHeaders = [
  'name',
  'sku',
  'barcode',
  'category',
  'unit',
  'costPriceLkr',
  'sellingPriceLkr',
  'minimumStock',
  'openingStock'
]

function exportCsvCell(value: string): string {
  const safeValue = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safeValue.replaceAll('"', '""')}"`
}

function downloadProductsCsv(products: Product[]): void {
  const rows = [
    productCsvHeaders,
    ...products.filter((product) => !product.archived).map((product) => [
      product.name,
      product.sku,
      product.barcode ?? '',
      product.categoryName ?? '',
      product.unit,
      formatMinorField(product.costPriceMinor),
      formatMinorField(product.sellingPriceMinor),
      formatMilliField(product.minimumStockMilli),
      formatMilliField(product.stockOnHandMilli)
    ])
  ]
  const content = rows.map((row) => row.map(exportCsvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'shop-products.csv'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface ProductFormProps {
  categories: Category[]
  product?: Product
  onSave: (input: ProductInput | ProductUpdate) => Promise<void>
  onCancel: () => void
}

function ProductForm({ categories, product, onSave, onCancel }: ProductFormProps) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)

    try {
      const base = {
        name: String(form.get('name') ?? ''),
        sku: String(form.get('sku') ?? ''),
        barcode: String(form.get('barcode') ?? ''),
        categoryId: String(form.get('categoryId') ?? '') || null,
        unit: String(form.get('unit') ?? ''),
        costPriceMinor: parseDecimalToScaled(String(form.get('costPrice') ?? ''), 2),
        sellingPriceMinor: parseDecimalToScaled(String(form.get('sellingPrice') ?? ''), 2),
        minimumStockMilli: parseDecimalToScaled(String(form.get('minimumStock') ?? ''), 3)
      }

      if (product) {
        const parsed = productUpdateSchema.safeParse(base)
        if (!parsed.success) throw new Error(firstIssue(parsed.error))
        setSaving(true)
        await onSave(parsed.data)
      } else {
        const parsed = productInputSchema.safeParse({
          ...base,
          openingStockMilli: parseDecimalToScaled(String(form.get('openingStock') ?? '0'), 3)
        })
        if (!parsed.success) throw new Error(firstIssue(parsed.error))
        setSaving(true)
        await onSave(parsed.data)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <LocalizeTree>
    <form className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-2" onSubmit={submit}>
      <label className="field">Product name
        <input name="name" required maxLength={160} defaultValue={product?.name ?? ''} autoFocus />
        <span className="field-hint">Use the name shown on shelf labels and customer receipts.</span>
      </label>
      <label className="field">SKU
        <input name="sku" required maxLength={80} defaultValue={product?.sku ?? ''} />
        <span className="field-hint">Enter a unique internal code for quick search and stock tracking.</span>
      </label>
      <label className="field">Barcode (optional)
        <input name="barcode" maxLength={100} defaultValue={product?.barcode ?? ''} />
        <span className="field-hint">Add the scanned barcode to speed up checkout.</span>
      </label>
      <label className="field">Category
        <select name="categoryId" defaultValue={product?.categoryId ?? ''}>
          <option value="">Uncategorized</option>
          {categories.filter((category) => !category.archived).map((category) => (
            <option value={category.id} key={category.id}>{category.name}</option>
          ))}
        </select>
        <span className="field-hint">Group this item with similar products, or leave it uncategorized.</span>
      </label>
      <label className="field">Unit
        <select name="unit" defaultValue={product?.unit ?? 'piece'}>
          <option value="piece">Piece</option>
          <option value="packet">Packet</option>
          <option value="kg">Kilogram</option>
          <option value="g">Gram</option>
          <option value="litre">Litre</option>
          <option value="ml">Millilitre</option>
        </select>
        <span className="field-hint">Choose the unit used for sales, purchasing, and stock counts.</span>
      </label>
      <label className="field">Cost price (LKR)
        <input name="costPrice" required inputMode="decimal" defaultValue={product ? formatMinorField(product.costPriceMinor) : '0.00'} />
        <span className="field-hint">Your current cost for one selected unit.</span>
      </label>
      <label className="field">Selling price (LKR)
        <input name="sellingPrice" required inputMode="decimal" defaultValue={product ? formatMinorField(product.sellingPriceMinor) : '0.00'} />
        <span className="field-hint">The standard customer price for one selected unit.</span>
      </label>
      <label className="field">Minimum stock
        <input name="minimumStock" required inputMode="decimal" defaultValue={product ? formatMilliField(product.minimumStockMilli) : '0.000'} />
        <span className="field-hint">Receive a low-stock indication when inventory reaches this level.</span>
      </label>
      {!product && (
        <label className="field">Opening stock
          <input name="openingStock" required inputMode="decimal" defaultValue="0.000" />
          <span className="field-hint">Quantity currently on hand when adding this product.</span>
        </label>
      )}
      {error && <p className="md:col-span-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 md:col-span-2">
        <button className="button-secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className="button-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : product ? 'Save changes' : 'Add product'}
        </button>
      </div>
    </form>
    </LocalizeTree>
  )
}

interface CategoryManagerProps {
  categories: Category[]
  onChange: () => Promise<void>
  showArchived: boolean
}

function CategoryManager({ categories, onChange, showArchived }: CategoryManagerProps) {
  const { language } = useLocalization()
  const [editing, setEditing] = useState<Category>()
  const [error, setError] = useState('')

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = categoryInputSchema.safeParse({
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? '')
    })
    if (!parsed.success) {
      setError(firstIssue(parsed.error))
      return
    }

    try {
      if (editing) await window.shopApi!.updateCategory(editing.id, parsed.data)
      else await window.shopApi!.createCategory(parsed.data)
      setEditing(undefined)
      formElement.reset()
      await onChange()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  async function toggleArchive(category: Category) {
    try {
      if (category.archived) await window.shopApi!.restoreCategory(category.id)
      else if (confirmDelete(category.name, language, 'archive')) {
        await window.shopApi!.archiveCategory(category.id)
      } else return
      setEditing(undefined)
      await onChange()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    }
  }

  return (
    <LocalizeTree>
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Categories</h2>
    <p className="mt-1 text-sm text-slate-500">Organize products into groups to make the catalog easier to manage.</p>
    <form className="mt-4 grid gap-3" onSubmit={saveCategory}>
        <label className="field">Category name
          <input name="name" required maxLength={100} defaultValue={editing?.name ?? ''} key={editing?.id ?? 'new'} />
          <span className="field-hint">Choose a clear name staff can use to organize products.</span>
        </label>
        <label className="field">Description
          <input name="description" maxLength={500} defaultValue={editing?.description ?? ''} key={`description-${editing?.id ?? 'new'}`} />
          <span className="field-hint">Optional note describing which products belong here.</span>
        </label>
        {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button className="button-primary flex-1" type="submit">{editing ? 'Save category' : 'Add category'}</button>
          {editing && <button className="button-secondary" type="button" onClick={() => setEditing(undefined)}>Cancel</button>}
        </div>
      </form>
      <ul className="mt-5 divide-y divide-slate-100">
        {categories.filter((category) => category.archived === showArchived).map((category) => (
          <li className="flex items-center justify-between gap-3 py-3" key={category.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{category.name}{category.archived && <span className="ml-2 text-xs text-slate-400">Archived</span>}</p>
              {category.description && <p className="truncate text-xs text-slate-500">{category.description}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              {!category.archived && <button className="text-xs font-medium text-slate-600 hover:text-emerald-700" onClick={() => setEditing(category)}>Edit</button>}
              <button className="text-xs font-medium text-slate-600 hover:text-rose-700" onClick={() => void toggleArchive(category)}>
                {category.archived ? 'Unarchive' : 'Delete'}
              </button>
            </div>
          </li>
        ))}
        {categories.length === 0 && <li className="py-4 text-sm text-slate-500">No categories yet.</li>}
      </ul>
    </section>
    </LocalizeTree>
  )
}

interface AdjustmentDialogProps {
  product: Product
  onClose: () => void
  onSave: (input: StockAdjustmentInput) => Promise<void>
}

function AdjustmentDialog({ product, onClose, onSave }: AdjustmentDialogProps) {
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const parsed = stockAdjustmentSchema.safeParse({
        productId: product.id,
        quantityDeltaMilli: parseDecimalToScaled(String(form.get('quantity') ?? ''), 3, true),
        reason: String(form.get('reason') ?? '')
      })
      if (!parsed.success) throw new Error(firstIssue(parsed.error))
      await onSave(parsed.data)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <LocalizeTree>
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/40 p-4" role="presentation">
      <form className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="adjust-title">
        <h2 id="adjust-title" className="text-lg font-semibold">Adjust {product.name} stock</h2>
        <p className="mt-1 text-sm text-slate-500">Current stock: {formatQuantity(product.stockOnHandMilli)} {unitLabels[product.unit]}</p>
        <label className="field mt-4">Quantity change (+ or −)
          <input name="quantity" required inputMode="decimal" placeholder="e.g. 2.000 or -1.000" autoFocus />
          <span className="field-hint">Use a positive value to add stock or a negative value to remove it.</span>
        </label>
        <label className="field mt-4">Reason (required)
          <textarea name="reason" required maxLength={300} rows={3} />
          <span className="field-hint">Record the reason for this adjustment for audit and review.</span>
        </label>
        {error && <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="button-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button-primary" type="submit">Record adjustment</button>
        </div>
      </form>
    </div>
    </LocalizeTree>
  )
}

interface StockCountDialogProps {
  product: Product
  onClose: () => void
  onSave: (input: StockReconciliationInput) => Promise<void>
}

function StockCountDialog({ product, onClose, onSave }: StockCountDialogProps) {
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const input: StockReconciliationInput = {
        productId: product.id,
        countedQuantityMilli: parseDecimalToScaled(String(form.get('countedQuantity') ?? ''), 3),
        reason: String(form.get('reason') ?? '')
      }
      await onSave(input)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <LocalizeTree>
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/40 p-4" role="presentation">
      <form className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="stock-count-title">
        <h2 id="stock-count-title" className="text-lg font-semibold">Reconcile {product.name}</h2>
        <p className="mt-1 text-sm text-slate-500">Recorded stock: {formatQuantity(product.stockOnHandMilli)} {unitLabels[product.unit]}</p>
        <label className="field mt-4">Physical count
          <input name="countedQuantity" required inputMode="decimal" min="0" placeholder="e.g. 12.000" autoFocus />
          <span className="field-hint">Enter the quantity physically counted. The system records the difference.</span>
        </label>
        <label className="field mt-4">Count reference or reason
          <textarea name="reason" required maxLength={300} rows={3} />
          <span className="field-hint">Include the count date, staff initials, or stocktake reference.</span>
        </label>
        {error && <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="button-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button-primary" type="submit">Save counted stock</button>
        </div>
      </form>
    </div>
    </LocalizeTree>
  )
}

export default function CatalogPage() {
  const { language } = useLocalization()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product>()
  const [adjustingProduct, setAdjustingProduct] = useState<Product>()
  const [countingProduct, setCountingProduct] = useState<Product>()
  const [movementProductId, setMovementProductId] = useState('')
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [movementLoading, setMovementLoading] = useState(false)
  const [importPreview, setImportPreview] = useState<ProductInput[]>()
  const [importFileName, setImportFileName] = useState('')
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const importFileRef = useRef<HTMLInputElement>(null)
  const [addingProduct, setAddingProduct] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!window.shopApi) {
      setLoading(false)
      setMovementLoading(false)
      return
    }
    setError('')
    setMovementLoading(true)
    try {
      const [nextProducts, nextCategories, nextMovements] = await Promise.all([
        window.shopApi.listProducts(search, showArchived),
        window.shopApi.listCategories(true),
        window.shopApi.listStockMovements(movementProductId || undefined, 200)
      ])
      setProducts(nextProducts)
      setCategories(nextCategories)
      setMovements(nextMovements)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
      setMovementLoading(false)
    }
  }, [search, showArchived, movementProductId])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  const visibleProducts = products.filter((product) => product.archived === showArchived)

  async function saveProduct(input: ProductInput | ProductUpdate) {
    if (!window.shopApi) throw new Error('The local database is available in the desktop app only.')
    if (editingProduct) {
      if (!('costPriceMinor' in input) || 'openingStockMilli' in input) {
        throw new Error('The product update form submitted an invalid payload')
      }
      await window.shopApi.updateProduct(editingProduct.id, input)
    } else {
      if (!('openingStockMilli' in input)) {
        throw new Error('The new product form requires an opening stock value')
      }
      await window.shopApi.createProduct(input)
    }
    setEditingProduct(undefined)
    setAddingProduct(false)
    await refresh()
  }

  async function toggleArchive(product: Product) {
    if (!window.shopApi) return
    try {
      if (product.archived) await window.shopApi.restoreProduct(product.id)
      else if (confirmDelete(product.name, language, 'archive')) {
        await window.shopApi.archiveProduct(product.id)
      } else return
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    }
  }

  async function adjustStock(input: StockAdjustmentInput) {
    if (!window.shopApi) throw new Error('The local database is available in the desktop app only.')
    await window.shopApi.adjustStock(input)
    await refresh()
  }

  async function reconcileStock(input: StockReconciliationInput) {
    if (!window.shopApi) throw new Error('The local database is available in the desktop app only.')
    await window.shopApi.reconcileStock(input)
    await refresh()
  }

  async function prepareProductImport(file?: File) {
    setImportPreview(undefined)
    setImportFileName('')
    setImportError('')
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setImportError('CSV files must be 5 MB or smaller')
      return
    }

    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) throw new Error('CSV must include the header row and at least one product')
      if (rows.length > 2001) throw new Error('Import is limited to 2,000 products per file')
      const headers = rows[0].map((header) => header.trim())
      if (headers.length !== productCsvHeaders.length
        || headers.some((header, index) => header.toLowerCase() !== productCsvHeaders[index].toLowerCase())) {
        throw new Error(`Use the product CSV columns in this order: ${productCsvHeaders.join(', ')}`)
      }

      const categoryIds = new Map(
        categories.filter((category) => !category.archived)
          .map((category) => [category.name.trim().toLocaleLowerCase(), category.id])
      )
      const existingProducts = window.shopApi
        ? await window.shopApi.listProducts('', true)
        : []
      const existingSkus = new Set(existingProducts.map((product) => product.sku.toLocaleLowerCase()))
      const existingBarcodes = new Set(existingProducts.map((product) => product.barcode?.toLocaleLowerCase()).filter(Boolean))
      const seenSkus = new Set<string>()
      const seenBarcodes = new Set<string>()
      const parsedProducts: ProductInput[] = rows.slice(1).map((cells, index) => {
        const rowNumber = index + 2
        if (cells.length !== productCsvHeaders.length) {
          throw new Error(`Row ${rowNumber} must contain ${productCsvHeaders.length} columns`)
        }
        const categoryName = cells[3].trim().toLocaleLowerCase()
        const categoryId = categoryName ? categoryIds.get(categoryName) : null
        if (categoryName && !categoryId) throw new Error(`Row ${rowNumber} has an unknown or archived category`)
        const candidate = {
          name: cells[0],
          sku: cells[1],
          barcode: cells[2],
          categoryId,
          unit: cells[4],
          costPriceMinor: parseDecimalToScaled(cells[5], 2),
          sellingPriceMinor: parseDecimalToScaled(cells[6], 2),
          minimumStockMilli: parseDecimalToScaled(cells[7], 3),
          openingStockMilli: parseDecimalToScaled(cells[8], 3)
        }
        const result = productInputSchema.safeParse(candidate)
        if (!result.success) throw new Error(`Row ${rowNumber}: ${firstIssue(result.error)}`)
        const sku = result.data.sku.toLocaleLowerCase()
        const barcode = result.data.barcode.toLocaleLowerCase()
        if (existingSkus.has(sku) || seenSkus.has(sku)) throw new Error(`Row ${rowNumber}: SKU "${result.data.sku}" already exists`)
        if (barcode && (existingBarcodes.has(barcode) || seenBarcodes.has(barcode))) {
          throw new Error(`Row ${rowNumber}: barcode "${result.data.barcode}" already exists`)
        }
        seenSkus.add(sku)
        if (barcode) seenBarcodes.add(barcode)
        return result.data
      })
      setImportFileName(file.name)
      setImportPreview(parsedProducts)
    } catch (parseError) {
      setImportError(parseError instanceof Error ? parseError.message : String(parseError))
    }
  }

  async function importProducts() {
    if (!window.shopApi || !importPreview) return
    setImporting(true)
    setImportError('')
    try {
      await window.shopApi.importProducts(importPreview)
      setImportPreview(undefined)
      setImportFileName('')
      if (importFileRef.current) importFileRef.current.value = ''
      await refresh()
    } catch (importFailure) {
      setImportError(importFailure instanceof Error ? importFailure.message : String(importFailure))
    } finally {
      setImporting(false)
    }
  }

  const lowStockCount = products.filter((product) => product.stockOnHandMilli <= product.minimumStockMilli).length
  const activeProducts = products.filter((product) => !product.archived)

  return (
    <LocalizeTree>
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-[1500px] px-6 py-8">
        {!window.shopApi && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            Browser preview only. Product and category data is available in the Electron desktop app.
          </div>
        )}
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-emerald-700">CATALOG</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Products & categories</h1>
            <p className="mt-2 text-sm text-slate-500">Manage prices, stock levels, and product organization.</p>
          </div>
          <button className="button-primary" onClick={() => { setEditingProduct(undefined); setAddingProduct(true) }} disabled={!window.shopApi}>
            Add product
          </button>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="metric-card"><p>Products</p><strong>{activeProducts.length}</strong><span>Active in catalog</span></div>
          <div className="metric-card"><p>Categories</p><strong>{categories.filter((category) => !category.archived).length}</strong><span>Active categories</span></div>
          <div className="metric-card"><p>Low stock</p><strong className={lowStockCount ? 'text-amber-700' : ''}>{lowStockCount}</strong><span>At or below minimum</span></div>
        </div>

        {(addingProduct || editingProduct) && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{editingProduct ? 'Edit product' : 'Add a product'}</h2>
              <p className="mt-1 text-sm text-slate-500">Enter accurate pricing and stock details. Prices support two decimal places; quantities support three.</p>
            </div>
            <ProductForm
              key={editingProduct?.id ?? 'new-product'}
              categories={categories}
              product={editingProduct}
              onSave={saveProduct}
              onCancel={() => { setAddingProduct(false); setEditingProduct(undefined) }}
            />
          </section>
        )}

        {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div>}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-semibold">Product list</h2>
                <p className="mt-1 text-sm text-slate-500">{products.length} matching products</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="sr-only" htmlFor="product-search">Search products</label>
                <input id="product-search" className="w-64" placeholder="Search name, SKU or barcode" value={search} onChange={(event) => setSearch(event.target.value)} />
                <input
                  ref={importFileRef}
                  className="hidden"
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Choose product CSV file"
                  onChange={(event) => void prepareProductImport(event.target.files?.[0])}
                />
                <button className="button-secondary" disabled={!window.shopApi} onClick={() => importFileRef.current?.click()}>
                  Import CSV
                </button>
                <button
                  className="button-secondary"
                  disabled={!window.shopApi || loading}
                  onClick={() => void window.shopApi?.listProducts('', true).then(downloadProductsCsv).catch((exportError) => {
                    setError(exportError instanceof Error ? exportError.message : String(exportError))
                  })}
                >
                  Export active CSV
                </button>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                  Show archived
                </label>
              </div>
              {(importPreview || importError) && (
                <div className="border-b border-slate-100 bg-slate-50 p-5">
                  {importFileName && <p className="mb-2 text-sm font-medium">Review {importFileName}</p>}
                  {importPreview && (
                    <>
                      <p className="text-sm text-slate-700">
                        {importPreview.length} new products are ready. Import is all-or-nothing; duplicate SKUs/barcodes are rejected.
                      </p>
                      <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
                        {importPreview.slice(0, 5).map((product) => <li key={product.sku}>{product.name} · {product.sku}</li>)}
                        {importPreview.length > 5 && <li>and {importPreview.length - 5} more…</li>}
                      </ul>
                      <button className="button-primary mt-3" disabled={importing} onClick={() => void importProducts()}>
                        {importing ? 'Importing…' : `Import ${importPreview.length} products`}
                      </button>
                      <button className="button-secondary ml-2 mt-3" disabled={importing} onClick={() => {
                        setImportPreview(undefined)
                        setImportFileName('')
                        if (importFileRef.current) importFileRef.current.value = ''
                      }}>Cancel</button>
                    </>
                  )}
                  {importError && <p className="text-sm text-rose-700" role="alert">{importError}</p>}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Price</th>
                    <th className="px-4 py-3 font-medium">Stock</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleProducts.map((product) => {
                    const isLow = product.stockOnHandMilli <= product.minimumStockMilli
                    return (
                      <tr key={product.id} className={product.archived ? 'bg-slate-50/70 text-slate-500' : ''}>
                        <td className="px-5 py-4">
                          <p className="font-medium text-slate-900">{product.name}</p>
                          <p className="mt-1 text-xs text-slate-500">SKU {product.sku}{product.barcode ? ` · ${product.barcode}` : ''}</p>
                        </td>
                        <td className="px-4 py-4">{product.categoryName ?? 'Uncategorized'}</td>
                        <td className="px-4 py-4 whitespace-nowrap">{formatMoney(product.sellingPriceMinor)}</td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={isLow && !product.archived ? 'font-semibold text-amber-700' : ''}>
                            {formatQuantity(product.stockOnHandMilli)} {unitLabels[product.unit]}
                          </span>
                        </td>
                        <td className="px-4 py-4">{product.archived ? 'Archived' : isLow ? 'Low stock' : 'Active'}</td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-3 whitespace-nowrap">
                            {!product.archived && <>
                              <button className="text-xs font-medium text-emerald-700 hover:text-emerald-900" onClick={() => { setAddingProduct(false); setEditingProduct(product) }}>Edit</button>
                              <button className="text-xs font-medium text-emerald-700 hover:text-emerald-900" onClick={() => setAdjustingProduct(product)}>Adjust stock</button>
                              <button className="text-xs font-medium text-emerald-700 hover:text-emerald-900" onClick={() => setCountingProduct(product)}>Count</button>
                            </>}
                            <button className="text-xs font-medium text-slate-600 hover:text-rose-700" onClick={() => void toggleArchive(product)}>
                              {product.archived ? 'Unarchive' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {loading && <p className="p-8 text-center text-sm text-slate-500">Loading catalog…</p>}
              {!loading && visibleProducts.length === 0 && (
                <div className="p-10 text-center">
                  <p className="font-medium text-slate-700">{search ? 'No matching products' : 'No products yet'}</p>
                  <p className="mt-1 text-sm text-slate-500">{search ? 'Try another product name, SKU, or barcode.' : 'Add your first product to start building the catalog.'}</p>
                </div>
              )}
            </div>
          </section>

          <CategoryManager categories={categories} onChange={refresh} showArchived={showArchived} />
        </div>

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-lg font-semibold">Inventory movement history</h2>
              <p className="mt-1 text-sm text-slate-500">Most recent 200 stock changes, including sales, receiving, returns, and counts.</p>
            </div>
            <label className="field min-w-56">
              Filter product
              <select value={movementProductId} onChange={(event) => setMovementProductId(event.target.value)}>
                <option value="">All products</option>
                {movementProductId && !products.some((product) => product.id === movementProductId) && (
                  <option value={movementProductId}>{movements[0]?.productName ?? 'Selected product'}</option>
                )}
                {products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.sku}</option>)}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date / time</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Movement</th>
                  <th className="px-4 py-3 font-medium">Change</th>
                  <th className="px-4 py-3 font-medium">Unit cost</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {language === 'si'
                        ? new Intl.DateTimeFormat('en-GB', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                            timeZone: 'Asia/Colombo'
                          }).format(new Date(movement.createdAt))
                        : new Intl.DateTimeFormat('en-LK', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: 'Asia/Colombo'
                          }).format(new Date(movement.createdAt))}
                    </td>
                    <td className="px-4 py-3">{movement.productName}<span className="ml-1 text-xs text-slate-500">{movement.sku}</span></td>
                    <td className="px-4 py-3">{movement.movementType.replaceAll('_', ' ')}</td>
                    <td className={`px-4 py-3 font-medium ${movement.quantityDeltaMilli < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {movement.quantityDeltaMilli > 0 ? '+' : ''}{formatQuantity(movement.quantityDeltaMilli)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatMoney(movement.unitCostMinor)}</td>
                    <td className="px-5 py-3">{movement.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {movementLoading && <p className="p-6 text-center text-sm text-slate-500">Loading movements…</p>}
            {!movementLoading && movements.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No inventory movements yet.</p>}
          </div>
        </section>
      </main>
      {adjustingProduct && <AdjustmentDialog
        product={adjustingProduct}
        onClose={() => setAdjustingProduct(undefined)}
        onSave={adjustStock}
      />}
      {countingProduct && <StockCountDialog
        product={countingProduct}
        onClose={() => setCountingProduct(undefined)}
        onSave={reconcileStock}
      />}
    </div>
    </LocalizeTree>
  )
}
