import type { DatabaseSync } from 'node:sqlite'

interface Migration {
  version: number
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE products (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
        barcode TEXT COLLATE NOCASE UNIQUE,
        category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
        unit TEXT NOT NULL CHECK (unit IN ('piece', 'packet', 'kg', 'g', 'litre', 'ml')),
        cost_price_minor INTEGER NOT NULL CHECK (cost_price_minor >= 0),
        selling_price_minor INTEGER NOT NULL CHECK (selling_price_minor >= 0),
        minimum_stock_milli INTEGER NOT NULL CHECK (minimum_stock_milli >= 0),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE stock_movements (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'adjustment', 'purchase', 'sale', 'return', 'purchase_return', 'damage')),
        quantity_delta_milli INTEGER NOT NULL CHECK (quantity_delta_milli != 0),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        reason TEXT NOT NULL,
        reference_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE sync_queue (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'synced', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX products_category_id_idx ON products(category_id);
      CREATE INDEX products_name_idx ON products(name COLLATE NOCASE);
      CREATE INDEX stock_movements_product_created_idx ON stock_movements(product_id, created_at);
      CREATE INDEX sync_queue_status_created_idx ON sync_queue(status, created_at);
      CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at);
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE invoice_sequences (
        business_date TEXT PRIMARY KEY NOT NULL,
        last_number INTEGER NOT NULL CHECK (last_number > 0)
      );

      CREATE TABLE sales (
        id TEXT PRIMARY KEY NOT NULL,
        invoice_number TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        business_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided', 'partially_returned', 'returned')),
        gross_sales_minor INTEGER NOT NULL CHECK (gross_sales_minor >= 0),
        line_discounts_minor INTEGER NOT NULL CHECK (line_discounts_minor >= 0),
        bill_discount_minor INTEGER NOT NULL CHECK (bill_discount_minor >= 0),
        net_sales_minor INTEGER NOT NULL CHECK (net_sales_minor >= 0),
        cost_of_goods_minor INTEGER NOT NULL CHECK (cost_of_goods_minor >= 0),
        created_at TEXT NOT NULL
      );

      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name_snapshot TEXT NOT NULL,
        sku_snapshot TEXT NOT NULL,
        unit_snapshot TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        gross_line_minor INTEGER NOT NULL CHECK (gross_line_minor >= 0),
        line_discount_minor INTEGER NOT NULL CHECK (line_discount_minor >= 0),
        allocated_bill_discount_minor INTEGER NOT NULL CHECK (allocated_bill_discount_minor >= 0),
        net_line_minor INTEGER NOT NULL CHECK (net_line_minor >= 0),
        cost_of_goods_minor INTEGER NOT NULL CHECK (cost_of_goods_minor >= 0)
      );

      CREATE TABLE sale_payments (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'qr')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        amount_received_minor INTEGER NOT NULL CHECK (amount_received_minor >= amount_minor),
        change_minor INTEGER NOT NULL CHECK (change_minor = amount_received_minor - amount_minor),
        created_at TEXT NOT NULL
      );

      CREATE INDEX sales_business_date_idx ON sales(business_date, status);
      CREATE INDEX sale_items_product_idx ON sale_items(product_id, sale_id);
      CREATE INDEX sale_payments_sale_idx ON sale_payments(sale_id);
    `
  },
  {
    version: 3,
    sql: `
      CREATE TABLE suppliers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX suppliers_name_idx ON suppliers(name COLLATE NOCASE);

      CREATE TABLE purchases (
        id TEXT PRIMARY KEY NOT NULL,
        purchase_number TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        supplier_invoice_number TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'received', 'cancelled')),
        additional_costs_minor INTEGER NOT NULL DEFAULT 0 CHECK (additional_costs_minor >= 0),
        total_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_minor >= 0),
        amount_paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        received_at TEXT
      );

      CREATE TABLE purchase_sequences (
        business_date TEXT PRIMARY KEY NOT NULL,
        last_number INTEGER NOT NULL CHECK (last_number > 0)
      );

      CREATE UNIQUE INDEX purchases_supplier_invoice_idx
        ON purchases(supplier_id, supplier_invoice_number)
        WHERE supplier_invoice_number IS NOT NULL AND supplier_invoice_number != '';
      CREATE INDEX purchases_supplier_status_idx ON purchases(supplier_id, status, created_at);

      CREATE TABLE purchase_items (
        id TEXT PRIMARY KEY NOT NULL,
        purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name_snapshot TEXT NOT NULL,
        sku_snapshot TEXT NOT NULL,
        unit_snapshot TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        extended_cost_minor INTEGER NOT NULL CHECK (extended_cost_minor >= 0),
        landed_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (landed_cost_minor >= 0)
      );

      CREATE INDEX purchase_items_product_idx ON purchase_items(product_id, purchase_id);

      CREATE TABLE supplier_payments (
        id TEXT PRIMARY KEY NOT NULL,
        purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'qr')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        reference TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX supplier_payments_supplier_created_idx ON supplier_payments(supplier_id, created_at);

      CREATE TABLE expense_categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE expenses (
        id TEXT PRIMARY KEY NOT NULL,
        category_id TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
        description TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'qr')),
        business_date TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX expenses_business_date_idx ON expenses(business_date, archived);
      CREATE INDEX expenses_category_idx ON expenses(category_id, business_date);

      INSERT INTO expense_categories (id, name, created_at, updated_at) VALUES
        ('00000000-0000-4000-8000-000000000001', 'Rent', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('00000000-0000-4000-8000-000000000002', 'Electricity', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('00000000-0000-4000-8000-000000000003', 'Transport', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('00000000-0000-4000-8000-000000000004', 'Wages', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('00000000-0000-4000-8000-000000000005', 'Packaging', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('00000000-0000-4000-8000-000000000006', 'Miscellaneous', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `
  },
  {
    version: 4,
    sql: `
      ALTER TABLE sale_items ADD COLUMN returned_quantity_milli INTEGER NOT NULL DEFAULT 0
        CHECK (returned_quantity_milli >= 0);
      ALTER TABLE sale_items ADD COLUMN returned_net_minor INTEGER NOT NULL DEFAULT 0
        CHECK (returned_net_minor >= 0);
      ALTER TABLE sale_items ADD COLUMN returned_resalable_quantity_milli INTEGER NOT NULL DEFAULT 0
        CHECK (returned_resalable_quantity_milli >= 0);
      ALTER TABLE sale_items ADD COLUMN returned_cost_minor INTEGER NOT NULL DEFAULT 0
        CHECK (returned_cost_minor >= 0);

      CREATE TABLE return_sequences (
        business_date TEXT PRIMARY KEY NOT NULL,
        last_number INTEGER NOT NULL CHECK (last_number > 0)
      );

      CREATE TABLE sales_returns (
        id TEXT PRIMARY KEY NOT NULL,
        return_number TEXT NOT NULL UNIQUE,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        refund_minor INTEGER NOT NULL CHECK (refund_minor >= 0),
        cost_reversal_minor INTEGER NOT NULL CHECK (cost_reversal_minor >= 0),
        refund_method TEXT NOT NULL CHECK (refund_method IN ('cash', 'card', 'bank_transfer', 'qr')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE sales_return_items (
        id TEXT PRIMARY KEY NOT NULL,
        return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
        sale_item_id TEXT NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name_snapshot TEXT NOT NULL,
        unit_snapshot TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        refund_minor INTEGER NOT NULL CHECK (refund_minor >= 0),
        cost_reversal_minor INTEGER NOT NULL CHECK (cost_reversal_minor >= 0),
        restocked INTEGER NOT NULL CHECK (restocked IN (0, 1))
      );

      CREATE TABLE return_payments (
        id TEXT PRIMARY KEY NOT NULL,
        return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'qr')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        created_at TEXT NOT NULL
      );

      CREATE INDEX sales_returns_sale_idx ON sales_returns(sale_id, created_at);
      CREATE INDEX sales_return_items_sale_item_idx ON sales_return_items(sale_item_id);
    `
  },
  {
    version: 5,
    sql: `
      CREATE TABLE cash_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        business_date TEXT NOT NULL UNIQUE,
        opening_cash_minor INTEGER NOT NULL CHECK (opening_cash_minor >= 0),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        expected_cash_minor INTEGER,
        actual_cash_minor INTEGER,
        discrepancy_minor INTEGER,
        opened_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE UNIQUE INDEX cash_sessions_one_open_idx ON cash_sessions(status)
        WHERE status = 'open';

      CREATE TABLE cash_movements (
        id TEXT PRIMARY KEY NOT NULL,
        cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        movement_type TEXT NOT NULL CHECK (movement_type IN (
          'sale_receipt', 'sale_refund', 'supplier_payment', 'expense',
          'owner_contribution', 'owner_withdrawal', 'manual_adjustment'
        )),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        reason TEXT NOT NULL,
        reference_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX cash_movements_session_created_idx ON cash_movements(cash_session_id, created_at);
    `
  },
  {
    version: 6,
    sql: `
      ALTER TABLE sales_returns ADD COLUMN business_date TEXT NOT NULL DEFAULT '';
      UPDATE sales_returns
      SET business_date = COALESCE(
        (SELECT business_date FROM sales WHERE sales.id = sales_returns.sale_id), ''
      );
      CREATE INDEX sales_returns_business_date_idx ON sales_returns(business_date);

      ALTER TABLE purchases ADD COLUMN received_business_date TEXT;
      UPDATE purchases SET received_business_date = date(received_at, '+5 hours', '+30 minutes')
      WHERE received_at IS NOT NULL;
      CREATE INDEX purchases_received_business_date_idx ON purchases(received_business_date);

      ALTER TABLE supplier_payments ADD COLUMN business_date TEXT NOT NULL DEFAULT '';
      UPDATE supplier_payments
      SET business_date = date(created_at, '+5 hours', '+30 minutes');
      CREATE INDEX supplier_payments_business_date_idx ON supplier_payments(business_date);

      CREATE TABLE sync_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 7,
    sql: `
      CREATE TABLE held_sales (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX held_sales_updated_idx ON held_sales(updated_at DESC);
    `
  },
  {
    version: 8,
    sql: `
      ALTER TABLE sales ADD COLUMN void_reason TEXT;
      ALTER TABLE sales ADD COLUMN voided_at TEXT;

      CREATE TABLE sale_void_payments (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'qr')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        created_at TEXT NOT NULL
      );

      CREATE INDEX sale_void_payments_sale_idx ON sale_void_payments(sale_id);
    `
  }
]

export function migrateDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)

  const currentVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  const pending = migrations.filter((migration) => migration.version > currentVersion)

  for (const migration of pending) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration.sql)
      database.exec(`PRAGMA user_version = ${migration.version}`)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
