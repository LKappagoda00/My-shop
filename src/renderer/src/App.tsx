import { useEffect, useState } from 'react'
import CatalogPage from './features/catalog/CatalogPage'
import PosPage from './features/pos/PosPage'
import ProcurementPage, { type ProcurementSection } from './features/procurement/ProcurementPage'
import ReturnsPage from './features/returns/ReturnsPage'
import CashPage from './features/cash/CashPage'
import ReportsPage from './features/reports/ReportsPage'
import { LocalizeTree, useLocalization } from './localization'

type AppPage = 'pos' | 'catalog' | 'returns' | 'cash' | 'reports' | ProcurementSection

const navigation: Array<{ section: string; items: Array<{ page: AppPage; label: string }> }> = [
  { section: 'Daily operations', items: [
    { page: 'pos', label: 'Point of sale' },
    { page: 'returns', label: 'Sales returns' },
    { page: 'cash', label: 'Cash management' }
  ] },
  { section: 'Inventory', items: [
    { page: 'catalog', label: 'Products & stock' },
    { page: 'purchases', label: 'Purchases' },
    { page: 'suppliers', label: 'Suppliers' }
  ] },
  { section: 'Business', items: [
    { page: 'expenses', label: 'Expenses' },
    { page: 'reports', label: 'Reports' }
  ] }
]

const pageIcons: Record<AppPage, string> = {
  pos: 'M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 8H6M10 21h.01M18 21h.01',
  returns: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2',
  cash: 'M3 7h18v13H3zM3 7l2-4h14l2 4M16 13h5M7 12h.01',
  catalog: 'M4 5h16M4 12h16M4 19h16M7 5v.01M7 12v.01M7 19v.01',
  purchases: 'M4 5h16v15H4zM8 3v4M16 3v4M4 10h16M8 14h3M8 17h6',
  suppliers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6',
  expenses: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  reports: 'M4 19V5M4 19h17M8 15l4-4 3 2 5-6M17 7h3v3'
}

function App() {
  const [version, setVersion] = useState<string>()
  const [page, setPage] = useState<AppPage>('pos')
  const { language, setLanguage } = useLocalization()
  const activeItem = navigation.flatMap((section) => section.items).find((item) => item.page === page)

  useEffect(() => {
    if (window.shopApi) {
      void window.shopApi.getAppVersion().then(setVersion)
    }
  }, [])

  return (
    <LocalizeTree>
    <div className="app-shell min-h-screen bg-slate-100 text-slate-900">
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="app-brand-mark">M</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-wide text-white">MY SHOP</p>
            <p className="text-[11px] text-slate-400">Retail management</p>
          </div>
        </div>
        <nav className="app-navigation" aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.section}>
              <p className="nav-group-label">{group.section}</p>
              {group.items.map((item) => (
                <button
                  key={item.page}
                  className={page === item.page ? 'nav-button nav-button-active' : 'nav-button'}
                  aria-current={page === item.page ? 'page' : undefined}
                  onClick={() => setPage(item.page)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={pageIcons[item.page]} />
                  </svg>
                  <span>{item.label}</span>
                  {page === item.page && <span className="nav-active-indicator" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className={window.shopApi ? 'connection-dot' : 'connection-dot connection-dot-preview'} />
          <div>
            <p className="text-xs font-semibold text-slate-200">{window.shopApi ? 'On this device' : 'Browser preview'}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{version ? `Version ${version}` : 'Offline-ready workspace'}</p>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="flex items-center gap-3">
            <div className="topbar-page-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={pageIcons[page]} />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{activeItem?.label}</p>
              <p className="text-xs text-slate-500">My Shop <span className="px-1 text-slate-300">/</span> {activeItem?.label}</p>
            </div>
          </div>
          <div className="topbar-meta">
            <div className="language-switch" role="group" aria-label="App language">
              <button
                type="button"
                aria-pressed={language === 'en'}
                className={language === 'en' ? 'language-button language-button-active' : 'language-button'}
                onClick={() => setLanguage('en')}
              >
                English
              </button>
              <button
                type="button"
                aria-pressed={language === 'si'}
                className={language === 'si' ? 'language-button language-button-active' : 'language-button'}
                onClick={() => setLanguage('si')}
              >
                Singlish
              </button>
            </div>
            <span className="topbar-date">
              {language === 'si'
                ? new Intl.DateTimeFormat('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    timeZone: 'Asia/Colombo'
                  }).format(new Date())
                : new Intl.DateTimeFormat('en-LK', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'Asia/Colombo'
                  }).format(new Date())}
            </span>
            <span className={window.shopApi ? 'connection-badge' : 'connection-badge preview-badge'}>
              <span className={window.shopApi ? 'connection-dot' : 'connection-dot connection-dot-preview'} />
              {window.shopApi ? 'Local database' : 'Preview mode'}
            </span>
          </div>
        </header>
        <div className="app-content">
          {page === 'pos' && <PosPage />}
          {page === 'catalog' && <CatalogPage />}
          {page === 'returns' && <ReturnsPage />}
          {page === 'cash' && <CashPage />}
          {page === 'reports' && <ReportsPage />}
          {(page === 'purchases' || page === 'suppliers' || page === 'expenses') && <ProcurementPage section={page} />}
        </div>
      </div>
    </div>
    </LocalizeTree>
  )
}

export default App
