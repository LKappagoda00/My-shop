// @vitest-environment node

import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CatalogRepository } from '../electron/database/catalog-repository'
import { migrateDatabase } from '../electron/database/migrations'
import type { CategoryInput, ProductInput } from '../src/shared/catalog'

describe('CatalogRepository', () => {
  let database: DatabaseSync
  let repository: CatalogRepository

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    repository = new CatalogRepository(database)
  })

  afterEach(() => {
    database.close()
  })

  it('creates categories and products with opening stock persisted as a movement', () => {
    const category = repository.createCategory({
      name: 'Dry goods',
      description: 'Rice, flour, and other pantry items'
    })
    const product = repository.createProduct({
      name: 'Red rice',
      sku: 'RICE-001',
      barcode: '4791234567890',
      categoryId: category.id,
      unit: 'kg',
      costPriceMinor: 26000,
      sellingPriceMinor: 32000,
      minimumStockMilli: 5000,
      openingStockMilli: 12500
    })

    expect(product.categoryName).toBe('Dry goods')
    expect(product.stockOnHandMilli).toBe(12500)
    expect(repository.listProducts('4791234567890')).toHaveLength(1)
    expect(database.prepare('SELECT COUNT(*) AS count FROM stock_movements').get()).toEqual({ count: 1 })
  })

  it('rejects duplicate SKUs and barcodes without leaving partial rows', () => {
    const product = repository.createProduct({
      name: 'Product A',
      sku: 'DUPLICATE',
      barcode: '111',
      categoryId: null,
      unit: 'piece',
      costPriceMinor: 100,
      sellingPriceMinor: 150,
      minimumStockMilli: 0,
      openingStockMilli: 0
    })
    const duplicateSku: ProductInput = {
      name: 'Product B',
      sku: 'duplicate',
      barcode: '222',
      categoryId: null,
      unit: 'piece',
      costPriceMinor: 100,
      sellingPriceMinor: 150,
      minimumStockMilli: 0,
      openingStockMilli: 0
    }

    expect(() => repository.createProduct(duplicateSku)).toThrow()
    expect(() => repository.createProduct({ ...duplicateSku, sku: 'UNIQUE', barcode: '111' })).toThrow()
    expect(repository.listProducts()).toHaveLength(1)
    expect(repository.listProducts()[0].id).toBe(product.id)
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_logs').get()).toEqual({ count: 1 })
  })

  it('records stock corrections with a reason and refuses negative stock', () => {
    const product = repository.createProduct({
      name: 'Milk',
      sku: 'MILK-01',
      barcode: '',
      categoryId: null,
      unit: 'litre',
      costPriceMinor: 30000,
      sellingPriceMinor: 40000,
      minimumStockMilli: 1000,
      openingStockMilli: 3000
    })

    const adjusted = repository.adjustStock({
      productId: product.id,
      quantityDeltaMilli: -1000,
      reason: 'One expired carton removed'
    })
    expect(adjusted.stockOnHandMilli).toBe(2000)
    expect(() => repository.adjustStock({
      productId: product.id,
      quantityDeltaMilli: -2500,
      reason: 'Attempt to over-adjust'
    })).toThrow('Stock adjustment cannot reduce inventory below zero')
    expect(repository.listProducts()[0].stockOnHandMilli).toBe(2000)
    expect(database.prepare('SELECT COUNT(*) AS count FROM sync_queue').get()).toEqual({ count: 2 })
  })

  it('reconciles a physical stock count and exposes immutable movement history', () => {
    const product = repository.createProduct({
      name: 'Rice',
      sku: 'RICE-COUNT',
      barcode: '',
      categoryId: null,
      unit: 'kg',
      costPriceMinor: 20000,
      sellingPriceMinor: 25000,
      minimumStockMilli: 0,
      openingStockMilli: 12500
    })

    const reconciled = repository.reconcileStock({
      productId: product.id,
      countedQuantityMilli: 10000,
      reason: 'Weekly shelf count'
    })
    expect(reconciled.stockOnHandMilli).toBe(10000)
    expect(repository.listStockMovements(product.id, 10)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        productId: product.id,
        movementType: 'adjustment',
        quantityDeltaMilli: -2500,
        reason: 'Stock count: Weekly shelf count'
      })
    ]))

    repository.reconcileStock({
      productId: product.id,
      countedQuantityMilli: 10000,
      reason: 'Count matches'
    })
    expect(repository.listStockMovements(product.id)).toHaveLength(2)
    expect(repository.listStockMovements(undefined, 1)).toHaveLength(1)
  })

  it('imports products atomically with auditable opening stock movements', () => {
    const category = repository.createCategory({ name: 'Pantry', description: '' })
    const imported = repository.importProducts([
      {
        name: 'Imported oats',
        sku: 'OATS-CSV',
        barcode: '4790000000099',
        categoryId: category.id,
        unit: 'packet',
        costPriceMinor: 350,
        sellingPriceMinor: 500,
        minimumStockMilli: 1000,
        openingStockMilli: 4000
      }
    ])
    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      name: 'Imported oats',
      stockOnHandMilli: 4000,
      categoryName: 'Pantry'
    })

    expect(() => repository.importProducts([
      {
        name: 'New product',
        sku: 'NEW-CSV',
        barcode: '',
        categoryId: null,
        unit: 'piece',
        costPriceMinor: 100,
        sellingPriceMinor: 200,
        minimumStockMilli: 0,
        openingStockMilli: 1000
      },
      {
        name: 'Duplicate sku',
        sku: 'OATS-CSV',
        barcode: '',
        categoryId: null,
        unit: 'piece',
        costPriceMinor: 100,
        sellingPriceMinor: 200,
        minimumStockMilli: 0,
        openingStockMilli: 0
      }
    ])).toThrow()
    expect(repository.listProducts().map((product) => product.sku)).toEqual(['OATS-CSV'])
  })

  it('archives and restores products and categories without deleting history', () => {
    const categoryInput: CategoryInput = { name: 'Drinks', description: '' }
    const category = repository.createCategory(categoryInput)
    const product = repository.createProduct({
      name: 'Water',
      sku: 'WATER-1',
      barcode: '',
      categoryId: category.id,
      unit: 'piece',
      costPriceMinor: 50,
      sellingPriceMinor: 100,
      minimumStockMilli: 0,
      openingStockMilli: 1000
    })

    repository.archiveProduct(product.id)
    expect(repository.listProducts()).toHaveLength(0)
    expect(repository.listProducts('', true)[0].stockOnHandMilli).toBe(1000)
    repository.restoreProduct(product.id)
    expect(repository.listProducts()).toHaveLength(1)

    repository.archiveCategory(category.id)
    expect(repository.listCategories()).toHaveLength(0)
    expect(repository.listProducts()[0].categoryName).toBe('Drinks')
    repository.restoreCategory(category.id)
    expect(repository.listCategories()).toHaveLength(1)
  })

  it('applies database migrations only once and keeps foreign keys enabled', () => {
    migrateDatabase(database)

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})
