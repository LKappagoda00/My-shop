import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { LocalizationProvider } from '../src/renderer/src/localization'

describe('App', () => {
  beforeEach(() => {
    window.localStorage.setItem('my-shop-language', 'en')
  })

  afterEach(() => {
    window.localStorage.removeItem('my-shop-language')
    vi.restoreAllMocks()
  })

  it('shows the desktop app version received through the preload API', async () => {
    Object.defineProperty(window, 'shopApi', {
      configurable: true,
      value: {
        getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
        listProducts: vi.fn().mockResolvedValue([]),
        listSales: vi.fn().mockResolvedValue([]),
        getCashStatus: vi.fn().mockResolvedValue({ current: null, today: null })
      }
    })

    render(<LocalizationProvider><App /></LocalizationProvider>)

    expect(await screen.findByText('Version 0.1.0')).toBeInTheDocument()
  })

  it('renders the welcome screen in a browser preview without Electron', () => {
    delete window.shopApi

    render(<LocalizationProvider><App /></LocalizationProvider>)

    expect(screen.getByText('Browser preview')).toBeInTheDocument()
  })
})
