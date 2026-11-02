# My Shop POS

Offline-first Windows point-of-sale and inventory application for a single
retail shop. The secure desktop shell, local catalog, checkout, procurement,
returns, cash management, and operational reports are implemented.

## Requirements

- Node.js 22.13 or later
- npm

The application uses Node's built-in `node:sqlite` API. It is experimental in
Node 22, so the exact Node/Electron version used for Windows packaging must be
validated before release.

## Development

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5174` in your browser. This runs the web interface and a
local Node.js API backed by SQLite; it does not open an Electron window. Keep
the terminal running while you use the system. Press `Ctrl+C` to stop it.

The database is stored at `%APPDATA%\my-shop-pos\shop.sqlite` and is shared
with the desktop version. The local API listens only on `127.0.0.1`.

To create a production web build and its local API bundle:

```powershell
npm run build:local
```

## Validation

```powershell
npm run typecheck
npm test
npm run build
npm run build:local
```

## Implemented so far

- Electron desktop shell with context isolation, renderer sandboxing, and Node
  integration disabled.
- A typed preload bridge with validated IPC for products, categories, stock
  adjustments, and sales.
- Versioned local SQLite database in Electron's per-user application data
  directory, with foreign keys, integrity checks, WAL, and full synchronous
  writes.
- Product and category create, edit, search, archive, and restore workflows.
- Opening stock and reason-required stock corrections recorded as immutable
  movements. Products are archived, not hard-deleted.
- Physical stock reconciliation and a product-filterable inventory movement
  history, including purchase, sale, return, and adjustment movements.
- Product CSV import/export. Imports validate the complete file before
  confirmation and commit atomically; they add new products only and require
  existing category names for categorized rows.
- POS product search and barcode/SKU keyboard entry, quantity and discount
  editing, cash/card/bank/QR checkout, cash change, and saved sale history.
- Locally persisted held carts with resume/delete actions, printed receipts, and
  reason-required sale voids that restore stock and refund the original tender
  methods atomically.
- Sales returns with partial refund allocation, resalable-item restocking,
  cost reversals, immutable snapshots, and cash-drawer integration.
- Supplier directory, purchase drafts and receiving, supplier payments,
  landed-cost allocation, weighted-average inventory cost updates, and
  categorized operating expenses.
- Open/close cash sessions, drawer reconciliation, and reason-required manual
  cash movements integrated with cash sales, refunds, supplier payments, and
  expenses.
- Sales use integer minor currency units, save line price/cost snapshots, use
  idempotency keys, and atomically persist the sale, payment, stock movements,
  audit record, and sync queue entry.
- Date-filtered dashboard and reports for sales, discounts, returns, cost of
  goods, gross/net profit, expenses, inventory purchases/payments, cash flow,
  current stock value, low stock, best sellers, supplier balances, and sync
  queue status. Reports can be printed or exported as CSV.
- Purchase receiving, supplier-payment, and return records use Colombo
  business dates for reporting.
- React, TypeScript, Vite, Tailwind CSS, React Router development setup,
  validation and chart dependencies for later phases.
- Vitest and React Testing Library configured for renderer tests.

## Project checklist

- [x] Establish the desktop architecture and development environment.
- [x] Set up versioned SQLite migrations, local persistence, and typed catalog access.
- [x] Implement core product/category management and auditable stock movements.
- [x] Implement atomic offline checkout, exact discounts, payment records, and sales history.
- [x] Complete stock movement history, physical-count reconciliation, and product CSV import/export.
- [x] Complete POS held sales, voids, receipt printing, and duplicate checkout submission handling.
- [x] Add suppliers, purchase drafts/receiving, supplier balances, and expenses.
- [x] Add customer sales returns and daily cash sessions.
- [x] Add exact financial calculations, reports, print view, and CSV export.
- [ ] Add supplier returns; implement database backup/restore and cloud API synchronization.
- [ ] Add authentication/settings, comprehensive integration coverage, and Windows packaging.

## Financial and checkout behavior

- Prices and discounts are stored as integer minor currency units (100 units per
  LKR); quantities use thousandths of the selected unit.
- Fractional line totals round half up to the nearest minor unit. A bill-level
  discount is allocated proportionally across lines using integer arithmetic,
  with any remaining minor units distributed by largest remainder.
- Each sale line retains its product name, SKU, selling-price, and cost
  snapshots. Updating a product later does not rewrite a completed sale.
- Cash payments record the amount applied, cash tendered, and change. Non-cash
  payment methods are never treated as physical cash. Partial customer-credit
  payments are not enabled.
- Inventory purchases are not operating expenses. Purchase receiving,
  weighted-average costing, and operating-expense records are separate.
- Sales returns reduce net sales and reverse the corresponding cost of goods;
  returned items are restocked only when marked resalable.
- Voids are restricted to completed sales with no returns; cash refunds require
  enough drawer funds and are committed atomically with stock restoration.
- Report date filters use the Sri Lankan business date. Current stock valuation
  and low-stock balances reflect present inventory, regardless of report date.
- Product CSV import accepts the exported column order
  (`name,sku,barcode,category,unit,costPriceLkr,sellingPriceLkr,minimumStock,openingStock`),
  limits each file to 2,000 rows, and rejects duplicate SKUs/barcodes rather
  than changing existing products.

## Local data and current limitations

- The SQLite database is stored as `shop.sqlite` under Electron's
  `app.getPath('userData')`; SQLite WAL files may exist beside it while the app
  is running.
- In browser-local mode, the same database is stored under
  `%APPDATA%\my-shop-pos\shop.sqlite`, and the local API owns database access.
- Catalog and sale records queue durable sync operations, but no cloud API or
  synchronization worker exists yet. The reports expose pending/failed counts
  and the last successful sync timestamp when one is recorded.
- The Electron binary may need a successful runtime download for desktop use.
  Browser-local use does not require Electron; run `npm run local` instead.
