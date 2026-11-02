import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CashStatus } from '../../../../shared/cash'
import { formatMoney, parseDecimalToScaled } from '../../../../shared/precision'
import { LocalizeTree } from '../../localization'

export default function CashPage() {
  const [status, setStatus] = useState<CashStatus>({ current: null, today: null })
  const [openingText, setOpeningText] = useState('0.00')
  const [actualText, setActualText] = useState('')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReason, setMovementReason] = useState('')
  const [movementDirection, setMovementDirection] = useState<'in' | 'out'>('in')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.shopApi) return
    try {
      setStatus(await window.shopApi.getCashStatus())
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const current = status.current
  const expected = current?.expectedCashMinor ?? status.today?.expectedCashMinor ?? 0
  const discrepancyPreview = useMemo(() => {
    try {
      const actual = parseDecimalToScaled(actualText, 2)
      return actual - expected
    } catch {
      return undefined
    }
  }, [actualText, expected])

  async function openSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    setSaving(true)
    setError('')
    try {
      await window.shopApi.openCashSession({
        openingCashMinor: parseDecimalToScaled(openingText, 2)
      })
      await refresh()
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      setSaving(false)
    }
  }

  async function closeSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    setSaving(true)
    setError('')
    try {
      await window.shopApi.closeCashSession({
        actualCashMinor: parseDecimalToScaled(actualText, 2)
      })
      await refresh()
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : String(closeError))
    } finally {
      setSaving(false)
    }
  }

  async function recordMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.shopApi) return
    setSaving(true)
    setError('')
    try {
      await window.shopApi.recordCashMovement({
        direction: movementDirection,
        amountMinor: parseDecimalToScaled(movementAmount, 2),
        reason: movementReason
      })
      setMovementAmount('')
      setMovementReason('')
      await refresh()
    } catch (movementError) {
      setError(movementError instanceof Error ? movementError.message : String(movementError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <LocalizeTree>
    <main className="mx-auto max-w-[1300px] px-6 py-8">
      {!window.shopApi && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Browser preview only. Cash sessions require the Electron local database.
        </div>
      )}
      <div className="mb-7">
        <p className="text-sm font-medium text-emerald-700">CASH CONTROL</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Cash management</h1>
        <p className="mt-2 text-sm text-slate-500">Open the till before taking cash payments, record movements, and reconcile the closing count.</p>
      </div>
      {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{current ? 'Session open' : status.today ? 'Today’s session closed' : 'No session today'}</p>
              <h2 className="mt-1 text-2xl font-semibold">{formatMoney(expected)}</h2>
              <p className="mt-1 text-sm text-slate-500">Expected drawer balance{current ? ` · ${current.businessDate}` : ''}</p>
            </div>
            {current && <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">Open</span>}
            {!current && status.today?.status === 'closed' && (
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">Closed</span>
            )}
          </div>

          {status.today?.status === 'closed' && (
            <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <p className="text-sm text-slate-600">Actual counted <strong className="block text-lg text-slate-900">{formatMoney(status.today.actualCashMinor ?? 0)}</strong></p>
              <p className="text-sm text-slate-600">Discrepancy <strong className={`block text-lg ${(status.today.discrepancyMinor ?? 0) === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatMoney(status.today.discrepancyMinor ?? 0)}</strong></p>
            </div>
          )}

          {current && (
            <div className="mt-6">
              <h3 className="font-semibold">Session movements</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {current.movements.map((movement) => (
                  <div className="flex justify-between gap-3 py-3" key={movement.id}>
                    <div><p className="text-sm font-medium">{movement.reason}</p><p className="mt-1 text-xs text-slate-500">{movement.movementType.replace(/_/g, ' ')} · {new Date(movement.createdAt).toLocaleTimeString()}</p></div>
                    <strong className={`text-sm ${movement.direction === 'in' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {movement.direction === 'in' ? '+' : '−'}{formatMoney(movement.amountMinor)}
                    </strong>
                  </div>
                ))}
                {current.movements.length === 0 && <p className="py-4 text-sm text-slate-500">No cash movements in this session.</p>}
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-6">
          {!current && !status.today && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold">Open cash session</h2>
              <p className="mt-1 text-sm text-slate-500">Count the opening float. Cash sales, refunds, expenses, and supplier payments require an open session.</p>
              <form className="mt-4 grid gap-4" onSubmit={(event) => void openSession(event)}>
                <label className="field">Opening cash (LKR)
                  <input inputMode="decimal" value={openingText} onChange={(event) => setOpeningText(event.target.value)} placeholder="0.00" />
                  <span className="field-hint">Enter the physical float counted before starting today’s transactions.</span>
                </label>
                <button className="button-primary" disabled={!window.shopApi || saving}>{saving ? 'Opening…' : 'Open till'}</button>
              </form>
            </section>
          )}

          {current && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-lg font-semibold">Manual cash movement</h2>
                <form className="mt-4 grid gap-4" onSubmit={(event) => void recordMovement(event)}>
                  <label className="field">Movement
                    <select value={movementDirection} onChange={(event) => setMovementDirection(event.target.value as 'in' | 'out')}>
                      <option value="in">Cash received / owner contribution</option>
                      <option value="out">Cash paid out / owner withdrawal</option>
                    </select>
                    <span className="field-hint">Choose whether cash is added to or removed from the drawer.</span>
                  </label>
                  <label className="field">Amount (LKR)
                    <input inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} placeholder="0.00" />
                    <span className="field-hint">Enter the amount moved. Cash paid out cannot exceed the drawer balance.</span>
                  </label>
                  <label className="field">Reason
                    <input required maxLength={300} value={movementReason} onChange={(event) => setMovementReason(event.target.value)} placeholder="e.g. Owner added change float" />
                    <span className="field-hint">Describe the movement for the session audit trail.</span>
                  </label>
                  <button className="button-primary" disabled={saving}>{saving ? 'Recording…' : 'Record movement'}</button>
                </form>
              </section>

              <section className="rounded-2xl border border-rose-200 bg-white p-5">
                <h2 className="text-lg font-semibold">Close cash session</h2>
                <p className="mt-1 text-sm text-slate-500">Count the cash physically in the drawer before closing.</p>
                <form className="mt-4 grid gap-4" onSubmit={(event) => void closeSession(event)}>
                  <label className="field">Actual cash counted (LKR)
                    <input inputMode="decimal" value={actualText} onChange={(event) => setActualText(event.target.value)} placeholder="0.00" />
                    <span className="field-hint">Count all physical cash in the drawer; the variance is calculated automatically.</span>
                  </label>
                  {discrepancyPreview !== undefined && (
                    <p className="text-sm text-slate-600">Estimated discrepancy <strong className={discrepancyPreview === 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatMoney(discrepancyPreview)}</strong></p>
                  )}
                  <button className="button-secondary border-rose-200 text-rose-800 hover:bg-rose-50" disabled={saving}>{saving ? 'Closing…' : 'Close and reconcile'}</button>
                </form>
              </section>
            </>
          )}

          {status.today?.status === 'closed' && !current && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold">Session completed</h2>
              <p className="mt-2 text-sm text-slate-500">Only one cash session is allowed per business date. You can start again tomorrow.</p>
            </section>
          )}
        </div>
      </div>
    </main>
    </LocalizeTree>
  )
}
