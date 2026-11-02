import { describe, expect, it, vi } from 'vitest'
import { createShopApi } from '../src/shared/shop-api'

describe('shop API payloads', () => {
  it('sends an empty object for operations with object schemas and no user input', async () => {
    const invoke = vi.fn().mockResolvedValue({})
    const api = createShopApi(invoke)

    await api.getCashStatus()
    await api.listExpenseCategories()

    expect(invoke).toHaveBeenNthCalledWith(1, 'cash:status', {})
    expect(invoke).toHaveBeenNthCalledWith(2, 'expenses:categories', {})
  })
})
