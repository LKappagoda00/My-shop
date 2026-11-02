import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'

export type AppLanguage = 'en' | 'si'

export type DeleteConfirmationMode = 'archive' | 'draft' | 'permanent'

export function confirmDelete(name: string, language: AppLanguage, mode: DeleteConfirmationMode): boolean {
  const message = language === 'si'
    ? mode === 'archive'
      ? `"${name}" delete karanna sure da?\n\nArchive karala thiyala, passe restore karanna puluwan. Kalin history eka rakagannawa.`
      : mode === 'draft'
        ? `"${name}" draft eka delete karanna sure da?\n\nDraft eka cancel wenawa. Stock saha payment history ain wenne naha.`
        : `"${name}" delete karanna sure da?\n\nMe kriyawa ayeth wenas karanna ba. Inventory ekata balapamak naha.`
    : mode === 'archive'
      ? `Are you sure you want to delete "${name}"?\n\nIt will be archived and can be restored. Existing history will be retained.`
      : mode === 'draft'
        ? `Are you sure you want to delete draft "${name}"?\n\nThe draft will be cancelled; stock and payment history will be retained.`
        : `Are you sure you want to delete "${name}"?\n\nThis cannot be undone and does not affect inventory.`

  return window.confirm(message)
}

export function confirmReopenPurchase(purchaseNumber: string, language: AppLanguage): boolean {
  const message = language === 'si'
    ? `${purchaseNumber} cancel kala purchase draft eka aye open karannada?\n\nGoods labunu bawa saha gewim confirm karanna puluwan. Confirm karana thuru stock wenas wenne naha.`
    : `Reopen cancelled purchase ${purchaseNumber}?\n\nYou can then confirm the goods received and any payment made. Stock will not change until you confirm receipt.`

  return window.confirm(message)
}

const singlish: Record<string, string> = {
  '· Balance': '· Itiriya',
  '· Cost reversal': '· Pita wiya mudala ain kirima',
  '· Eligible': '· Refund karanna puluwan',
  '· Paid': '· Gewuwa',
  '· Returned': '· Apasu dunna',
  Actions: 'Kriyakarakam',
  Active: 'Sakriyai',
  'Active categories': 'Sakriya categories',
  'Active in catalog': 'Catalog eke sakriyai',
  'Actual cash counted (LKR)': 'Aththatama ganan kala cash (LKR)',
  'Actual counted': 'Aththatama ganan kala',
  'App language': 'App eke bhashawa',
  'Add a bank reference, receipt number, or other payment identifier.': 'Bank reference, receipt number, hari payment ekata adala wena identifier ekak danna.',
  'Add a contact number for orders and account enquiries.': 'Orders saha account visthara ahanna contact number ekak danna.',
  'Add a product': 'Product ekak add karanna',
  'Add a product to begin checkout.': 'Checkout eka patan ganna product ekak add karanna.',
  'Add a short, recognizable description for reports and audits.': 'Reports saha audit walata handunaganna lesi punchi wistharayak danna.',
  'Add category': 'Category ekak add karanna',
  'Add item': 'Item ekak add karanna',
  'Add product': 'Product ekak add karanna',
  'Add product to purchase': 'Purchase ekata product ekak add karanna',
  'Add supplier': 'Supplier kenek add karanna',
  'Add the scanned barcode to speed up checkout.': 'Checkout eka ikman karaganna scan karapu barcode eka danna.',
  'Add useful details such as delivery days, terms, or account references.': 'Delivery dawas, terms, nathnam account references wage wadagath thorathuru danna.',
  'Add your first product to start building the catalog.': 'Catalog eka hadanna oyage palaweni product eka add karanna.',
  'Additional landed costs (LKR)': 'Anith genwima wiyadam (LKR)',
  Address: 'Lipinaya',
  Adjust: 'Wenas karanna',
  'Adjust stock': 'Stock wenas karanna',
  'All products': 'Siyalu products',
  Amount: 'Mudala',
  'Amount (LKR)': 'Mudala (LKR)',
  and: 'saha',
  Archive: 'Archive karanna',
  Archived: 'Archive karala',
  'At or below minimum': 'Minimum pramanayata hari eeta adui',
  available: 'thiyenawa',
  'Bank transfer': 'Bank transfer',
  'Barcode (optional)': 'Barcode (optional)',
  'Best-selling products': 'Hondatama vikunena products',
  'Bill discount': 'Bill eke discount eka',
  'Bill discount (LKR)': 'Bill eke discount eka (LKR)',
  'Briefly explain why the item is being returned': 'Me item eka apasu denne ai kiyala ketiyen kiyanna',
  'Browser preview': 'Browser preview eka',
  'Browser preview only. Cash sessions require the Electron local database.': 'Browser preview eka witharai. Cash sessions walata Electron local database eka one.',
  'Browser preview only. Offline checkout requires the Electron desktop app and its local database.': 'Browser preview eka witharai. Offline checkout walata Electron desktop app eka saha local database eka one.',
  'Browser preview only. Product and category data is available in the Electron desktop app.': 'Browser preview eka witharai. Product saha category thorathuru Electron desktop app eken balanna.',
  'Browser preview only. Reports require the Electron local database.': 'Browser preview eka witharai. Reports walata Electron local database eka one.',
  'Browser preview only. Sales returns require the Electron local database.': 'Browser preview eka witharai. Sales returns walata Electron local database eka one.',
  'Browser preview only. Supplier, purchase, and expense records require the Electron local database.': 'Browser preview eka witharai. Supplier, purchase, saha expense thorathuru walata Electron local database eka one.',
  Cancel: 'Cancel karanna',
  'Cancel draft': 'Draft eka cancel karanna',
  'Delete draft': 'Draft eka delete karanna',
  'Reopen cancelled draft': 'Cancel kala draft eka aye open karanna',
  Unarchive: 'Archive eken ain karanna',
  'Cancel edit': 'Edit eka nawaththanna',
  Card: 'Card',
  'Cart quantity exceeds current stock.': 'Cart eke quantity eka danata thiyena stock pramanayata wada wadi.',
  cash: 'Cash',
  Cash: 'Cash',
  'CASH CONTROL': 'CASH kalamanakaranaya',
  CATALOG: 'CATALOG eka',
  'Cash management': 'Cash kalamanakaranaya',
  'Cash paid out / owner withdrawal': 'Cash pita dunna / himikaruge ganna eka',
  'Cash received (LKR)': 'Labunu cash (LKR)',
  'Cash received / owner contribution': 'Labunu cash / himikaruge ekathu kirima',
  'Cash received is less than the amount due.': 'Labunu cash eka gewiya yuthu gananata wada adui.',
  Categories: 'Categories',
  Category: 'Category',
  'Category name': 'Category eke nama',
  Change: 'Wenas karanna',
  'CHECKOUT': 'CHECKOUT',
  'Choose a clear name staff can use to organize products.': 'Products piliwelata thiyanna staff lata pahasu nama thoranawa.',
  'Choose how the expense was settled. Cash payments are recorded in the till.': 'Expense eka gewuwe kohomada kiyala thoranna. Cash gewim till eke record wenawa.',
  'Choose how the refund will be issued. Cash refunds require an open till.': 'Refund eka dena widihata thoranna. Cash refund walata till eka open karala thiyenna one.',
  'Choose product CSV file': 'Product CSV file eka thoranna',
  'Choose the supplier responsible for this delivery.': 'Me delivery eka gena ena supplierwa thoranna.',
  'Choose the unit used for sales, purchasing, and stock counts.': 'Vikunum, purchases, saha stock ganan walata use karana unit eka thoranna.',
  'Choose whether cash is added to or removed from the drawer.': 'Cash drawer ekata salli ekathu karanawada, nathnam ain karanawada kiyala thoranna.',
  'Clear cart': 'Cart eka clear karanna',
  Close: 'Wahanna',
  'Close and reconcile': 'Wahala ganan balanna',
  'Close cash session': 'Cash session eka wahanna',
  'Close sale details': 'Sale thorathuru wahanna',
  closed: 'wahala',
  Closed: 'Wahala',
  'Closing…': 'Wahanawa…',
  'Complete checkout': 'Checkout eka iwara karanna',
  completed: 'iwara kala',
  'Confirm receipt': 'Labagath bawa confirm karanna',
  'Confirm the delivered goods and record any payment made now. Stock and weighted-average cost update together.': 'Labunu badu confirm karala dan gewapu mudalak thiyenawanam record karanna. Stock saha average cost ekata update wenawa.',
  'Correct invalid quantity or discount fields before checkout.': 'Checkout ekata kalin waradi quantity hari discount fields hari hadanna.',
  Cost: 'Pita wiya',
  'Cost price (LKR)': 'Ganna mila (LKR)',
  Count: 'Ganan karanna',
  'Count all physical cash in the drawer; the variance is calculated automatically.': 'Drawer eke thiyena siyalu cash ganan karanna; wenasaka ganana auto hadenawa.',
  'Count reference or reason': 'Ganan reference eka hari hetuwa',
  'Count the cash physically in the drawer before closing.': 'Wahanna kalin drawer eke aththatama thiyena cash ganan karanna.',
  'Count the opening float. Cash sales, refunds, expenses, and supplier payments require an open session.': 'Patangaddi thiyena cash ganan karanna. Cash sales, refunds, expenses, saha supplier payments walata open session ekak one.',
  'Create draft': 'Draft ekak hadanna',
  'Create purchase draft': 'Purchase draft ekak hadanna',
  'Create supplier': 'Supplier kenek add karanna',
  'Current sale': 'Dan karana sale eka',
  'Current stock:': 'Danata thiyena stock:',
  'CUSTOMER SERVICE': 'CUSTOMER SEWA',
  'Daily net sales': 'Ada net sales',
  'Dashboard & reports': 'Dashboard saha reports',
  Date: 'Dinaya',
  'Date / time': 'Dinaya / welawa',
  Delete: 'Delete karanna',
  'Delivered quantity.': 'Labuna quantity eka.',
  'Describe the movement for the session audit trail.': 'Audit record ekata me cash movement eka wisthara karanna.',
  Description: 'Wistharaya',
  'Discount (LKR)': 'Discount (LKR)',
  Discounts: 'Discounts',
  Discrepancy: 'Ganan wala wenas',
  'distinct items': 'wena item',
  draft: 'draft',
  'e.g. 12.000': 'udaharanayak: 12.000',
  'e.g. 2.000 or -1.000': 'udaharanayak: 2.000 nathnam -1.000',
  'e.g. October electricity bill': 'udaharanayak: October current bill',
  'e.g. Owner added change float': 'udaharanayak: Himikaru change salli ekathu kala',
  Edit: 'Edit karanna',
  'Edit draft': 'Draft eka edit karanna',
  'Edit expense': 'Expense eka edit karanna',
  'Edit product': 'Product eka edit karanna',
  'Edit purchase draft': 'Purchase draft eka edit karanna',
  'Edit supplier': 'Supplierwa edit karanna',
  'End date': 'Awasana dinaya',
  'End date for the report, inclusive.': 'Report ekata athulath awasana dinaya.',
  'Enter a unique internal code for quick search and stock tracking.': 'Ikmanata hoyanna saha stock balanna unique internal code ekak danna.',
  'Enter accurate pricing and stock details. Prices support two decimal places; quantities support three.': 'Mila saha stock hariyata danna. Mila decimal sthana dekak, quantity decimal sthana thunak danna puluwan.',
  'Enter invoice number': 'Invoice number eka danna',
  'Enter the amount moved. Cash paid out cannot exceed the drawer balance.': 'Maru kala mudala danna. Pita ganna cash eka drawer eke mudalata wada wadi wenna ba.',
  'Enter the amount received. Change due is calculated automatically.': 'Labuna mudala danna. Ithuru mudala auto ganan hadenawa.',
  'Enter the physical float counted before starting today’s transactions.': 'Ada transaction patan ganna kalin ganan kala float mudala danna.',
  'Enter the quantity physically counted. The system records the difference.': 'Aththatama ganan kala quantity eka danna. System eka wenasaka record karanawa.',
  'Enter the reference printed on the supplier’s invoice, if available.': 'Thiyenawanam supplier invoice eke thiyena reference eka danna.',
  'Enter the supplier’s registered or commonly used business name.': 'Supplier ge business nama danna.',
  'Enter the total amount paid or payable.': 'Gewapu hari gewanna thiyena sampurna mudala danna.',
  'Estimated discrepancy': 'Andaja karapu ganan wenasaka',
  'Estimated purchase total': 'Andaja karapu purchase ekathu mila',
  'Estimated refund': 'Andaja refund eka',
  'Expected drawer balance': 'Drawer eke thiyenna one mudala',
  'Expense date': 'Expense eka kala dinaya',
  Expenses: 'Wiyadam',
  'Expenses by category': 'Category anuwa expenses',
  'Export active CSV': 'Sakriya CSV export karanna',
  'Export CSV': 'CSV export karanna',
  'F2 search · F4 checkout · Esc clear search': 'Search ekata F2 · Checkout ekata F4 · Search clear karanna Esc',
  failed: 'asarthakai',
  'Filter product': 'Product filter karanna',
  'Filtered total': 'Filter kala ekathuwa',
  'Financial summary': 'Salli gana samastha wistharaya',
  'Find a product': 'Product ekak hoyanna',
  'Find original sale': 'Mul sale eka hoyanna',
  From: 'Indala',
  Gram: 'Gram',
  Gross: 'Gross',
  'Gross profit': 'Gross laba',
  'Gross sales': 'Gross vikunum',
  'Group this item with similar products, or leave it uncategorized.': 'Me item eka saman products ekka category ekakata danna, nathnam category ekak nathuwa thiyanna.',
  'Held sales': 'Hold karapu sales',
  'Hold sale': 'Sale eka hold karanna',
  'Import CSV': 'CSV import karanna',
  'Importing…': 'Import karanawa…',
  'Include freight or handling costs. These are allocated across received products.': 'Freight saha handling wiyadam athulath karanna. Ewa labuna products athara bedanawa.',
  'Include the count date, staff initials, or stocktake reference.': 'Ganan kala dinaya, staff initials, nathnam stocktake reference eka athulath karanna.',
  'Inventory movement history': 'Inventory wenas wena history eka',
  'Inventory purchases are tracked separately and are not counted as expenses.': 'Inventory purchases wenama record wenawa; expenses widihata ganan ganne na.',
  Invoice: 'Invoice',
  'Invoice number': 'Invoice number eka',
  'Item discounts': 'Item discounts',
  'Keep supplier details up to date for purchase records and payment tracking.': 'Purchase records saha gewim balanna supplier thorathuru update karala thiyaganna.',
  Kilogram: 'Kilogram',
  'Last successful sync:': 'Awasaana sarthaka sync eka:',
  'Leave unchecked for damaged or unsellable items.': 'Kadayata danne nathi, damage una badu nam tick eka ain karanna.',
  Litre: 'Litre',
  'Loading catalog…': 'Catalog eka load wenawa…',
  'Loading movements…': 'Movements load wenawa…',
  'Loading products…': 'Products load wenawa…',
  'Loading report…': 'Report eka load wenawa…',
  'Loading suppliers…': 'Suppliers load wenawa…',
  'Local database': 'Local database eka',
  'Log day-to-day operating costs. Inventory purchases are recorded separately.': 'Dawas pata business wiyadam record karanna. Inventory purchases wenama record wenawa.',
  'Low stock': 'Stock adui',
  'Main navigation': 'Pradhana navigation eka',
  'Manage prices, stock levels, and product organization.': 'Mila, stock pramanaya, saha product piliwela kalamanakaranaya karanna.',
  'Manual cash movement': 'Athin karana cash movement eka',
  'Maximum:': 'Uparima:',
  Millilitre: 'Millilitre',
  Minimum: 'Awama',
  'Minimum stock': 'Awama stock pramanaya',
  'Most recent 200 stock changes, including sales, receiving, returns, and counts.': 'Aluthma stock wenas 200, sales, labaganim, returns, saha ganan athulath.',
  Movement: 'Movement eka',
  'My Shop': 'My Shop',
  'MY SHOP': 'MY SHOP',
  'Net of discounts and returns ·': 'Discount saha returns ain kala net ganana ·',
  'Net profit': 'Net laba',
  'Net quantity': 'Net quantity',
  'Net sales': 'Net sales',
  Never: 'Kisida',
  'new products are ready. Import is all-or-nothing; duplicate SKUs/barcodes are rejected.': 'aluth products ready. Import eka okkoma hari unoth witharai wenne; duplicate SKUs/barcodes bara ganne na.',
  'No cash movements in this session.': 'Me session eke cash movements naha.',
  'No categories yet.': 'Thama categories naha.',
  'No expenses match these filters.': 'Me filters walata galapena expenses naha.',
  'No held sales.': 'Hold karapu sales naha.',
  'No inventory movements yet.': 'Thama inventory movements naha.',
  'No matching products': 'Galapena products naha',
  'No matching products found.': 'Galapena products hoyaganna bari una.',
  'No operating expenses in this date range.': 'Me dina athara business expenses naha.',
  'No phone': 'Phone number naha',
  'No product sales in this date range.': 'Me dina athara products vikunala naha.',
  'No products are at or below minimum stock.': 'Minimum stock ekata hari eeta aduwen thiyena products naha.',
  'No products are available for sale.': 'Vikunanna products naha.',
  'No products yet': 'Thama products naha',
  'No purchases found.': 'Purchases hoyaganna bari una.',
  'No returns found.': 'Returns hoyaganna bari una.',
  'No sales, returns, or expenses in this date range.': 'Me dina athara sales, returns, hari expenses naha.',
  'No saved sales found.': 'Save kala sales hoyaganna bari una.',
  'No session today': 'Ada session ekak naha',
  'No suppliers found.': 'Suppliers hoyaganna bari una.',
  'No suppliers recorded.': 'Supplier kenek record karala naha.',
  Notes: 'Satahan',
  'Offline-ready workspace': 'Internet nathuwath wada karana workspace eka',
  'On hand': 'Athata thiyena',
  'On this device': 'Me device eke',
  'Only one cash session is allowed per business date. You can start again tomorrow.': 'Business dinayakata cash session ekak witharai puluwan. Heta aye patan ganna puluwan.',
  Open: 'Open',
  'Open cash session': 'Cash session eka open karanna',
  'Open the till before taking cash payments, record movements, and reconcile the closing count.': 'Cash gewim ganna kalin till eka open karanna, movements record karala wahaddi ganan balanna.',
  'Open till': 'Till eka open karanna',
  'Open today’s cash session from Cash management before accepting a cash payment.': 'Cash payment ganna kalin ada cash session eka Cash management eken open karanna.',
  'Opening cash (LKR)': 'Patangaddi thibba cash (LKR)',
  'Opening stock': 'Patangaddi thibba stock',
  'Opening…': 'Open wenawa…',
  'Operating expenses': 'Business expenses',
  'Optional business or delivery address.': 'Business hari delivery address eka (optional).',
  'Optional discount applied across the whole sale.': 'Sale eka pura apply karana discount eka (optional).',
  'Optional item discount.': 'Item discount eka (optional).',
  'Optional note describing which products belong here.': 'Me category ekata ayithi products gena optional satahanak.',
  'Optional reference from the supplier': 'Supplier gen optional reference ekak',
  'Organize products into groups to make the catalog easier to manage.': 'Catalog eka lehesiyen balanna products group walata bedanna.',
  Outstanding: 'Gewanna ithiri',
  'Outstanding balance': 'Gewanna ithiri mudala',
  Packet: 'Packet',
  'Pay supplier balance': 'Supplier ge ithiri mudala gewanna',
  'Payment method': 'Gewana kramaya',
  'Payment now (LKR)': 'Dan gewana mudala (LKR)',
  Payments: 'Gewim',
  Phone: 'Phone',
  'Physical count': 'Aththatama ganan kala',
  Piece: 'Piece',
  'Point of sale': 'Badu vikunana thanaya',
  'Prepare the supplier invoice here. Inventory changes only after you confirm receipt.': 'Supplier invoice eka methana hadanna. Labuna bawa confirm kalata passe witharai stock wenas wenne.',
  'Press Enter after scanning a barcode or SKU to add the matching product.': 'Barcode hari SKU eka scan karala Enter gahuwama adala product eka add wenawa.',
  'Preview mode': 'Preview mode eka',
  Price: 'Mila',
  Print: 'Print karanna',
  'Print receipt': 'Receipt eka print karanna',
  'Processing return…': 'Return eka process karanawa…',
  Product: 'Product',
  'Product list': 'Product list eka',
  'Product name': 'Product eke nama',
  Products: 'Badu',
  'Products & categories': 'Products saha categories',
  'Purchase history': 'Purchase history eka',
  'Purchase or supplier invoice': 'Purchase hari supplier invoice eka',
  'QR payment': 'QR payment',
  Quantity: 'Quantity',
  'Quantity change (+ or −)': 'Quantity wenasaya (+ hari −)',
  'Quantity currently on hand when adding this product.': 'Me product eka add karaddi danata atha thiyena quantity eka.',
  'Quantity is measured in': 'Quantity eka maninne',
  Reason: 'Hetuwa',
  'Reason (required)': 'Hetuwa (aniwaryai)',
  'Reason for voiding this invoice': 'Me invoice eka cancel karana hetuwa',
  'Receive a low-stock indication when inventory reaches this level.': 'Inventory eka me pramanayata awama stock adui kiyala pennanawa.',
  'Receive purchase': 'Purchase eka bara ganna',
  'Receive stock': 'Stock bara ganna',
  received: 'labuna',
  'Recent saved invoices': 'Langadi save kala invoices',
  Reconcile: 'Ganan hariyata balanna',
  'Record a payment against the outstanding balance for this purchase.': 'Me purchase eke gewanna ithiri mudalata payment ekak record karanna.',
  'Record adjustment': 'Stock wenasaya record karanna',
  'Record expense': 'Expense eka record karanna',
  'Record movement': 'Movement eka record karanna',
  'Record payment': 'Payment eka record karanna',
  'Record return & refund': 'Return saha refund eka record karanna',
  'Record supplier payment': 'Supplier payment eka record karanna',
  'Record the reason for this adjustment for audit and review.': 'Audit saha balanna me stock wenas karana hetuwa record karanna.',
  'Recorded stock:': 'Record kala stock eka:',
  'Recording…': 'Record karanawa…',
  'Reference (optional)': 'Reference eka (optional)',
  Refresh: 'Aye load karanna',
  Refund: 'Refund',
  'Refund eligible sale quantities and restock only goods approved for resale.': 'Refund karanna puluwan vikunu quantity walata refund deela, aye vikunanna puluwan badu witharak stock ekata danna.',
  'Refund method': 'Refund dena kramaya',
  'Resalable and safe to return to stock': 'Aye vikunanna puluwan, stock ekata danna surakshithai',
  Restore: 'Aye sakriya karanna',
  Resume: 'Aye arambha karanna',
  'Retail management': 'Kade kalamanakaranaya',
  'Return history': 'Return history eka',
  'Return or sale invoice': 'Return hari sale invoice eka',
  'Return qty': 'Apasu dunna quantity',
  'Return reason': 'Return karana hetuwa',
  Returns: 'Returns',
  'Sales returns': 'Vikunum apasu bara ganim',
  Review: 'Aye balanna',
  'Sales history': 'Sales history eka',
  'Sales receipt': 'Sales receipt eka',
  'Sales, margins, expenses, inventory, and shop activity': 'Sales, laba ansa, expenses, inventory, saha kade wada',
  'Save category': 'Category eka save karanna',
  'Save changes': 'Wenas kam save karanna',
  'Save counted stock': 'Ganan kala stock eka save karanna',
  'Save draft': 'Draft eka save karanna',
  'Save supplier': 'Supplierwa save karanna',
  'Saved carts persist locally until checked out or deleted.': 'Save kala carts checkout karana thuru hari delete karana thuru me device eke thiyenawa.',
  'Saving sale…': 'Sale eka save karanawa…',
  'Saving…': 'Save karanawa…',
  'Scan a barcode or search the catalog, review the cart, and complete payment.': 'Barcode eka scan karanna hari catalog eke hoyanna, cart eka balala payment eka iwara karanna.',
  Search: 'Hoyanna',
  'Search an invoice to start a return.': 'Return eka patan ganna invoice ekak hoyanna.',
  'Search by product name, SKU, or scan barcode': 'Product nama, SKU, hari barcode eka scan karala hoyanna',
  'Search description or category': 'Wistharaya hari category eka hoyanna',
  'Search expenses': 'Expenses hoyanna',
  'Search name or phone': 'Nama hari phone number eken hoyanna',
  'Search name, SKU or barcode': 'Nama, SKU, hari barcode eken hoyanna',
  'Search products': 'Products hoyanna',
  'Search purchases': 'Purchases hoyanna',
  'Search return history': 'Return history hoyanna',
  'Search sale invoice': 'Sale invoice eka hoyanna',
  'Search sales by invoice': 'Invoice eken sales hoyanna',
  'Search suppliers': 'Suppliers hoyanna',
  'Select an existing catalog product.': 'Catalog eke thiyena product ekak thoranna.',
  'Select supplier': 'Supplier kenek thoranna',
  'Select the category that best describes this operating cost.': 'Me business wiyadama hondinma wisthara karana category eka thoranna.',
  'Select the method used for this supplier payment.': 'Me supplier payment ekata use karana kramaya thoranna.',
  'Select the tender used to settle this sale.': 'Me sale eka gewanna use karapu payment kramaya thoranna.',
  'Selected product': 'Thoragath product eka',
  'Selling price (LKR)': 'Vikunum mila (LKR)',
  'Session completed': 'Session eka iwara kala',
  'Session movements': 'Session eke movements',
  'Session open': 'Session eka open',
  'Show archived': 'Archive kala ewa pennanna',
  SKU: 'SKU',
  Sold: 'Vikunala',
  'Start date': 'Patanganna dinaya',
  'Start date for the report. Dates use Sri Lanka business time.': 'Report eke patanganna dinaya. Sri Lanka business time eka use wenawa.',
  Status: 'Thathwaya',
  Stock: 'Stock',
  'Stock is added only when a draft is received.': 'Draft eka labunata passe witharai stock ekathu wenne.',
  Supplier: 'Supplier',
  Suppliers: 'Supplierla',
  'Supplier balances': 'Supplier lage ithiri mudal',
  'Supplier directory': 'Supplier wisthara list eka',
  'Supplier invoice number': 'Supplier invoice number eka',
  'Supplier name': 'Supplier ge nama',
  'Supplier’s cost per selected unit before landed costs.': 'Genwima wiyadam ekathu karanna kalin unit ekakata supplier ganna mila.',
  'Sync queue:': 'Sync wenna thiyena ganana:',
  Purchases: 'Badu miladi ganim',
  Reports: 'Reports saha wisthara',
  'Thank you for shopping with us.': 'Ape kaden gaththata bohoma sthuthi.',
  'The refund estimate reflects discounts already applied to the original sale.': 'Refund andajama original sale ekata dapu discounts ganan gannawa.',
  'The sale, payment, and stock update are saved together to this device.': 'Sale eka, payment eka, saha stock update eka ekata me device eke save wenawa.',
  'The standard customer price for one selected unit.': 'Thorapu unit ekakata customer ta dena samanya mila.',
  'Today’s session closed': 'Ada session eka wahala',
  'This note is saved with the return for future reference.': 'Me satahana issarahata balanna return eka samaga save wenawa.',
  To: 'Dakwa',
  Total: 'Ekathuwa',
  'Total due': 'Gewanna thiyena ekathuwa',
  'Transaction or receipt number': 'Transaction hari receipt number eka',
  'Try another product name, SKU, or barcode.': 'Wena product nama, SKU, hari barcode ekak try karanna.',
  Uncategorized: 'Category ekak nathi',
  Unit: 'Unit eka',
  'Unit cost': 'Unit ekaka ganna mila',
  'Unit cost (LKR)': 'Unit ekaka ganna mila (LKR)',
  'Up to 3 decimals.': 'Decimal sthana 3k dakwa.',
  'Updating…': 'Update karanawa…',
  'Use a positive value to add stock or a negative value to remove it.': 'Stock ekathu karanna positive gananayak, adu karanna negative gananayak danna.',
  'Use the name shown on shelf labels and customer receipts.': 'Shelf labels saha customer receipts wala thiyena nama use karanna.',
  'Used to group this expense in daily and monthly reports.': 'Dawas pata saha masika reports wala me expense eka category karanna use wenawa.',
  'Void invoice': 'Invoice eka cancel karanna',
  'Void reason:': 'Cancel karana hetuwa:',
  'Void sale (refunds original tenders and restores stock)': 'Sale eka cancel karanna (kalin payment refund karala stock aye danna)',
  voided: 'cancel kala',
  VOIDED: 'CANCEL KALA',
  'Voiding…': 'Cancel karanawa…',
  'Your current cost for one selected unit.': 'Thorapu unit ekakata oyage danata ganna mila.',
  ' · not resalable': ' · aye vikunanna ba',
  ' · restocked': ' · aye stock ekata damma',
  discount: 'discount',
  quantity: 'quantity',
  'return quantity': 'apasu dunna quantity',
  opening: 'patangaddi',
  adjustment: 'stock wenas kirima',
  purchase: 'purchase',
  sale: 'sale',
  return: 'return',
  'purchase return': 'purchase return',
  damage: 'damage',
  'pending ·': 'ithiri ·',
  'syncing ·': 'sync wenawa ·',
  'matching products': 'galapena products',
  'items · Updated': 'items · update kala',
  'trading days': 'business dawas',
  'more…': 'tawath…',
  piece: 'piece eka',
  receive: 'bara ganna',
  to: 'dakwa',
  short: 'short',
  M: 'M',
  English: 'English',
  Singlish: 'Singlish',
  'Daily operations': 'Dawas pata wada',
  Inventory: 'Stock saha badu',
  Business: 'Business wada',
  'Products & stock': 'Products saha stock',
  Catalog: 'Catalog eka',
  Checkout: 'Checkout eka',
  'Loading…': 'Load wenawa…',
  'No data available': 'Thorathuru naha',
  'pieces': 'pieces',
  'packets': 'packets',
  'litres': 'litres',
  'per': 'kata',
  'Loading': 'Load wenawa',
  'Version': 'Version',
  'Invalid request:': 'Waradi request ekak:',
  'Invalid input:': 'Waradi input ekak:',
  'Check the entered values and try again.': 'Dapu agayan balala aye try karanna.',
  'Select a value': 'Agayak thoranna',
  'None': 'Mokuth naha',
  'Yes': 'Ow',
  'No': 'Na',
  'From date': 'Me dinaye indala',
  'To date': 'Me dinaya dakwa'
}

interface LocalizationContextValue {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  translate: (text: string) => string
}

const LocalizationContext = createContext<LocalizationContextValue | null>(null)

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    try {
      return window.localStorage.getItem('my-shop-language') === 'si' ? 'si' : 'en'
    } catch {
      return 'en'
    }
  })

  const setLanguage = (nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage)
    try {
      window.localStorage.setItem('my-shop-language', nextLanguage)
    } catch {
      console.warn('Could not save the selected app language')
    }
  }

  const translate = (text: string): string => {
    if (language === 'en') return text

    const normalized = text.replace(/\s+/g, ' ').trim()
    const exact = singlish[normalized]
    if (exact) {
      const leading = text.match(/^\s*/)?.[0] ?? ''
      const trailing = text.match(/\s*$/)?.[0] ?? ''
      return `${leading}${exact}${trailing}`
    }

    const dynamicPrefixes: Array<[string, string]> = [
      ['Current stock:', 'Danata thiyena stock:'],
      ['Maximum:', 'Uparima:'],
      ['Last successful sync:', 'Awasaana sarthaka sync eka:'],
      ['Sync queue:', 'Sync wenna thiyena ganana:'],
      ['Version ', 'Version '],
      ['items · Updated', 'items · Update kala'],
      ['Remove ', 'Ain karanna '],
      ['Held ', 'Hold kala '],
      ['Sale ', 'Sale eka ']
    ]
    for (const [english, translated] of dynamicPrefixes) {
      if (normalized.startsWith(english)) {
        return text.replace(english, translated)
      }
    }

    const quantitySuffix = normalized.match(/^(.*?)( quantity| discount| return quantity)$/)
    if (quantitySuffix) {
      const suffix = singlish[quantitySuffix[2].trim()] ?? quantitySuffix[2].trim()
      return `${quantitySuffix[1]} ${suffix}`
    }

    return text
  }

  const value = useMemo(() => ({ language, setLanguage, translate }), [language])
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>
}

export function useLocalization(): LocalizationContextValue {
  const value = useContext(LocalizationContext)
  if (!value) throw new Error('useLocalization must be used within LocalizationProvider')
  return value
}

type LocalizableProps = {
  children?: ReactNode
  placeholder?: string
  title?: string
  alt?: string
  'aria-label'?: string
  'aria-description'?: string
}

function localizeNode(node: ReactNode, translate: (text: string) => string): ReactNode {
  if (typeof node === 'string') return translate(node)
  if (Array.isArray(node)) return Children.map(node, (child) => localizeNode(child, translate))
  if (!isValidElement<LocalizableProps>(node)) return node

  const props = { ...node.props }
  if (typeof props.children !== 'undefined') props.children = localizeNode(props.children, translate)
  for (const attribute of ['placeholder', 'title', 'alt', 'aria-label', 'aria-description'] as const) {
    const value = props[attribute]
    if (typeof value === 'string') props[attribute] = translate(value)
  }

  return cloneElement(node as ReactElement<LocalizableProps>, props)
}

export function LocalizeTree({ children }: { children: ReactNode }) {
  const { translate } = useLocalization()
  return <>{localizeNode(children, translate)}</>
}
