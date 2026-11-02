import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Supplier, SupplierInput } from '../../../../shared/procurement'
import { supplierInputSchema } from '../../../../shared/procurement'
import { formatMoney } from '../../../../shared/precision'
import { confirmDelete, LocalizeTree, useLocalization } from '../../localization'

export default function SuppliersPage() {
  const { language } = useLocalization()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Supplier>()
  const [actionSupplierId, setActionSupplierId] = useState<string>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const actionInProgress = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    if (!window.shopApi) {
      setLoading(false)
      return
    }
    try {
      setSuppliers(await window.shopApi.listSuppliers(search, showArchived))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [search, showArchived])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    const form = new FormData(event.currentTarget)
    const parsed = supplierInputSchema.safeParse({
      name: String(form.get('name') ?? ''),
      phone: String(form.get('phone') ?? ''),
      address: String(form.get('address') ?? ''),
      notes: String(form.get('notes') ?? '')
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check supplier details.')
      return
    }

    try {
      const input: SupplierInput = parsed.data
      if (editing) await window.shopApi.updateSupplier(editing.id, input)
      else await window.shopApi.createSupplier(input)
      setEditing(undefined)
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  async function toggleArchive(supplier: Supplier) {
    if (!window.shopApi || actionInProgress.current.has(supplier.id)) return
    actionInProgress.current.add(supplier.id)
    setActionSupplierId(supplier.id)
    try {
      if (supplier.archived) await window.shopApi.restoreSupplier(supplier.id)
      else if (confirmDelete(supplier.name, language, 'archive')) {
        await window.shopApi.archiveSupplier(supplier.id)
      } else return
      await refresh()
    } catch (actionError) {
      await refresh()
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    } finally {
      actionInProgress.current.delete(supplier.id)
      setActionSupplierId(undefined)
    }
  }

  const visibleSuppliers = suppliers.filter((supplier) => supplier.archived === showArchived)

  return (
    <LocalizeTree>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div><h2 className="text-lg font-semibold">Supplier directory</h2><p className="mt-1 text-sm text-slate-500">{visibleSuppliers.length} suppliers</p></div>
          <div className="flex items-center gap-3">
            <input aria-label="Search suppliers" className="w-56" placeholder="Search name or phone" value={search} onChange={(event) => setSearch(event.target.value)} />
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
          </div>
        </div>
        {error && <p className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
        {loading && <p className="p-8 text-center text-sm text-slate-500">Loading suppliers…</p>}
        {!loading && visibleSuppliers.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No suppliers found.</p>}
        <ul className="divide-y divide-slate-100">
          {visibleSuppliers.map((supplier) => (
            <li className="flex flex-wrap items-center justify-between gap-4 p-5" key={supplier.id}>
              <div>
                <p className="font-semibold">{supplier.name}{supplier.archived && <span className="ml-2 text-xs text-slate-400">Archived</span>}</p>
                <p className="mt-1 text-sm text-slate-500">{supplier.phone || 'No phone'}{supplier.address ? ` · ${supplier.address}` : ''}</p>
                <p className={`mt-2 text-sm font-medium ${supplier.outstandingMinor > 0 ? 'text-amber-700' : 'text-slate-600'}`}>
                  Outstanding {formatMoney(supplier.outstandingMinor)}
                </p>
              </div>
              <div className="flex gap-3">
                {!supplier.archived && <button className="text-sm font-medium text-emerald-700" onClick={() => setEditing(supplier)}>Edit</button>}
                <button className="text-sm font-medium text-slate-600 hover:text-rose-700" disabled={actionSupplierId === supplier.id} onClick={() => void toggleArchive(supplier)}>
                  {actionSupplierId === supplier.id ? 'Saving…' : supplier.archived ? 'Unarchive' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{editing ? 'Edit supplier' : 'Add supplier'}</h2>
        <p className="mt-1 text-sm text-slate-500">Keep supplier details up to date for purchase records and payment tracking.</p>
        <form className="mt-4 grid gap-4" onSubmit={(event) => void save(event)}>
          <label className="field">Supplier name
            <input name="name" required maxLength={160} defaultValue={editing?.name ?? ''} key={editing?.id ?? 'new'} />
            <span className="field-hint">Enter the supplier’s registered or commonly used business name.</span>
          </label>
          <label className="field">Phone
            <input name="phone" maxLength={80} defaultValue={editing?.phone ?? ''} key={`phone-${editing?.id ?? 'new'}`} />
            <span className="field-hint">Add a contact number for orders and account enquiries.</span>
          </label>
          <label className="field">Address
            <input name="address" maxLength={500} defaultValue={editing?.address ?? ''} key={`address-${editing?.id ?? 'new'}`} />
            <span className="field-hint">Optional business or delivery address.</span>
          </label>
          <label className="field">Notes
            <textarea name="notes" rows={3} maxLength={1000} defaultValue={editing?.notes ?? ''} key={`notes-${editing?.id ?? 'new'}`} />
            <span className="field-hint">Add useful details such as delivery days, terms, or account references.</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="button-primary flex-1" disabled={!window.shopApi}>{editing ? 'Save supplier' : 'Create supplier'}</button>
            {editing && <button type="button" className="button-secondary" onClick={() => setEditing(undefined)}>Cancel</button>}
          </div>
        </form>
      </section>
    </div>
    </LocalizeTree>
  )
}
