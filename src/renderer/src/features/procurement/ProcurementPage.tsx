import ExpensesPage from './ExpensesPage'
import PurchasesPage from './PurchasesPage'
import SuppliersPage from './SuppliersPage'
import { LocalizeTree } from '../../localization'

export type ProcurementSection = 'purchases' | 'suppliers' | 'expenses'

const headings: Record<ProcurementSection, { eyebrow: string; title: string; subtitle: string }> = {
  purchases: {
    eyebrow: 'INVENTORY INTAKE',
    title: 'Purchases',
    subtitle: 'Receive supplier invoices, add stock, and track supplier balances.'
  },
  suppliers: {
    eyebrow: 'VENDOR DIRECTORY',
    title: 'Suppliers',
    subtitle: 'Maintain supplier contact information and outstanding balances.'
  },
  expenses: {
    eyebrow: 'OPERATING COSTS',
    title: 'Expenses',
    subtitle: 'Record operating expenses separately from inventory purchases.'
  }
}

interface ProcurementPageProps {
  section: ProcurementSection
}

export default function ProcurementPage({ section }: ProcurementPageProps) {
  const heading = headings[section]

  return (
    <LocalizeTree>
    <main className="mx-auto max-w-[1500px] px-6 py-8">
      {!window.shopApi && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Browser preview only. Supplier, purchase, and expense records require the Electron local database.
        </div>
      )}
      <div className="mb-7">
        <p className="text-sm font-medium text-emerald-700">{heading.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{heading.title}</h1>
        <p className="mt-2 text-sm text-slate-500">{heading.subtitle}</p>
      </div>
      {section === 'purchases' && <PurchasesPage />}
      {section === 'suppliers' && <SuppliersPage />}
      {section === 'expenses' && <ExpensesPage />}
    </main>
    </LocalizeTree>
  )
}
