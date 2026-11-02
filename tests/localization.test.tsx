import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { confirmDelete, LocalizationProvider } from '../src/renderer/src/localization'

describe('app language switch', () => {
  afterEach(() => {
    window.localStorage.removeItem('my-shop-language')
    delete window.shopApi
  })

  describe('delete confirmation', () => {
    afterEach(() => vi.restoreAllMocks())

    it('asks for confirmation before deleting and explains that recoverable records are archived', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

      expect(confirmDelete('Tea', 'en', 'archive')).toBe(true)
      expect(confirm).toHaveBeenCalledWith(
        'Are you sure you want to delete "Tea"?\n\nIt will be archived and can be restored. Existing history will be retained.'
      )

      confirm.mockRestore()
    })

    it('uses Singlish confirmation text when Singlish is selected', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

      expect(confirmDelete('Tea', 'si', 'archive')).toBe(false)
      expect(confirm).toHaveBeenCalledWith(
        '"Tea" delete karanna sure da?\n\nArchive karala thiyala, passe restore karanna puluwan. Kalin history eka rakagannawa.'
      )

      confirm.mockRestore()
    })
  })

  it('switches visible navigation and checkout copy to Singlish and remembers the selection', () => {
    render(<LocalizationProvider><App /></LocalizationProvider>)

    fireEvent.click(within(screen.getAllByRole('group', { name: 'App language' })[0]).getByRole('button', { name: 'Singlish' }))

    expect(screen.getAllByText('Badu vikunana thanaya').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Barcode eka scan karanna hari catalog eke hoyanna, cart eka balala payment eka iwara karanna.')).toBeInTheDocument()
    expect(window.localStorage.getItem('my-shop-language')).toBe('si')
  })

  it('restores English when the English option is selected', () => {
    window.localStorage.setItem('my-shop-language', 'si')
    render(<LocalizationProvider><App /></LocalizationProvider>)

    fireEvent.click(within(screen.getAllByRole('group', { name: 'App eke bhashawa' })[0]).getByRole('button', { name: 'English' }))

    expect(screen.getAllByText('Point of sale')).toHaveLength(3)
    expect(window.localStorage.getItem('my-shop-language')).toBe('en')
  })

  it('localizes a feature page and its descriptions', () => {
    render(<LocalizationProvider><App /></LocalizationProvider>)
    fireEvent.click(within(screen.getByRole('group', { name: 'App language' })).getByRole('button', { name: 'Singlish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Products saha stock' }))

    expect(screen.getByText('Products saha categories')).toBeInTheDocument()
    expect(screen.getByText('Mila, stock pramanaya, saha product piliwela kalamanakaranaya karanna.')).toBeInTheDocument()
  })
})
