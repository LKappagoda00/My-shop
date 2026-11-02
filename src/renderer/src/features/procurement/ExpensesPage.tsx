import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Expense, ExpenseInput } from '../../../../shared/procurement'
import { expenseInputSchema } from '../../../../shared/procurement'
import { sriLankaBusinessDate } from '../../../../shared/business-date'
import { paymentMethods } from '../../../../shared/sales'
import { formatMinorField, formatMoney, parseDecimalToScaled } from '../../../../shared/precision'
import { confirmDelete, LocalizeTree, useLocalization } from '../../localization'

const methodLabels = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  qr: 'QR payment'
} as const

export default function ExpensesPage() {
  const { language } = useLocalization()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Awaited<ReturnType<NonNullable<Window['shopApi']>['listExpenseCategories']>>>([])
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Expense>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.shopApi) return
    try {
      const [nextExpenses, nextCategories] = await Promise.all([
        window.shopApi.listExpenses(search, fromDate || undefined, toDate || undefined, showArchived),
        window.shopApi.listExpenseCategories()
      ])
      setExpenses(nextExpenses)
      setCategories(nextCategories)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [fromDate, search, showArchived, toDate])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    const form = new FormData(event.currentTarget)
    let amountMinor: number
    try {
      amountMinor = parseDecimalToScaled(String(form.get('amount') ?? ''), 2)
    } catch (inputError) {
      setError(inputError instanceof Error ? inputError.message : String(inputError))
      return
    }

    const method = paymentMethods.find((value) => value === String(form.get('method') ?? ''))
    const parsed = expenseInputSchema.safeParse({
      categoryId: String(form.get('categoryId') ?? ''),
      description: String(form.get('description') ?? ''),
      amountMinor,
      method,
      businessDate: String(form.get('businessDate') ?? '')
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check expense details.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const input: ExpenseInput = parsed.data
      if (editing) await window.shopApi.updateExpense(editing.id, input)
      else await window.shopApi.createExpense(input)
      setEditing(undefined)
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function archive(expense: Expense) {
    if (!window.shopApi) return
    if (!confirmDelete(expense.description, language, 'archive')) return
    try {
      await window.shopApi.archiveExpense(expense.id)
      setEditing(undefined)
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    }
  }

  async function restore(expense: Expense) {
    if (!window.shopApi) return
    try {
      await window.shopApi.restoreExpense(expense.id)
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    }
  }

  const total = expenses.reduce((sum, expense) => sum + BigInt(expense.archived ? 0 : expense.amountMinor), 0n)
  const totalLabel = total <= BigInt(Number.MAX_SAFE_INTEGER)
    ? formatMoney(Number(total))
    : 'Total exceeds supported display range'
  const visibleExpenses = expenses.filter((expense) => expense.archived === showArchived)

  return (
    <LocalizeTree>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Operating expenses</h2><p className="mt-1 text-sm text-slate-500">Inventory purchases are tracked separately and are not counted as expenses.</p></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">Filtered total </span><strong>{totalLabel}</strong></div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(200px,1fr)_160px_160px_auto]">
            <input aria-label="Search expenses" placeholder="Search description or category" value={search} onChange={(event) => setSearch(event.target.value)} />
            <label className="field">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label className="field">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
          </div>
        </div>
        {error && <p className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
        <div className="divide-y divide-slate-100">
          {visibleExpenses.map((expense) => (
            <div key={expense.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="font-medium">{expense.description}{expense.archived && <span className="ml-2 text-xs text-slate-400">Archived</span>}</p>
                <p className="mt-1 text-xs text-slate-500">{expense.categoryName} · {expense.businessDate} · {methodLabels[expense.method]}</p>
              </div>
              <div className="flex items-center gap-4">
                <strong className="text-sm">{formatMoney(expense.amountMinor)}</strong>
                {!expense.archived && <button className="text-sm font-medium text-emerald-700" onClick={() => setEditing(expense)}>Edit</button>}
                {expense.archived
                  ? <button className="text-sm font-medium text-emerald-700" onClick={() => void restore(expense)}>Unarchive</button>
                  : <button className="text-sm font-medium text-slate-600 hover:text-rose-700" onClick={() => void archive(expense)}>Delete</button>}
              </div>
            </div>
          ))}
          {visibleExpenses.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No expenses match these filters.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{editing ? 'Edit expense' : 'Record expense'}</h2>
        <p className="mt-1 text-sm text-slate-500">Log day-to-day operating costs. Inventory purchases are recorded separately.</p>
        <form className="mt-4 grid gap-4" onSubmit={(event) => void save(event)}>
          <label className="field">Category
            <select name="categoryId" defaultValue={editing?.categoryId ?? categories[0]?.id ?? ''} key={`category-${editing?.id ?? categories[0]?.id ?? 'empty'}`} required>
              {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
            <span className="field-hint">Select the category that best describes this operating cost.</span>
          </label>
          <label className="field">Description
            <input name="description" required maxLength={300} defaultValue={editing?.description ?? ''} key={`description-${editing?.id ?? 'new'}`} placeholder="e.g. October electricity bill" />
            <span className="field-hint">Add a short, recognizable description for reports and audits.</span>
          </label>
          <label className="field">Amount (LKR)
            <input name="amount" required inputMode="decimal" placeholder="0.00" defaultValue={editing ? formatMinorField(editing.amountMinor) : ''} key={`amount-${editing?.id ?? 'new'}`} />
            <span className="field-hint">Enter the total amount paid or payable.</span>
          </label>
          <label className="field">Expense date
            <input name="businessDate" type="date" required defaultValue={editing?.businessDate ?? sriLankaBusinessDate()} key={`date-${editing?.id ?? 'new'}`} />
            <span className="field-hint">Used to group this expense in daily and monthly reports.</span>
          </label>
          <label className="field">Payment method
            <select name="method" defaultValue={editing?.method ?? 'cash'} key={`method-${editing?.id ?? 'new'}`}>
              {paymentMethods.map((method) => <option value={method} key={method}>{methodLabels[method]}</option>)}
            </select>
            <span className="field-hint">Choose how the expense was settled. Cash payments are recorded in the till.</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="button-primary flex-1" disabled={!window.shopApi || saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Record expense'}</button>
            {editing && <button type="button" className="button-secondary" onClick={() => setEditing(undefined)}>Cancel</button>}
          </div>
        </form>
      </section>
    </div>
    </LocalizeTree>
  )
}
