import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'
import { createShopApi } from '../../shared/shop-api'
import { LocalizationProvider } from './localization'

if (!window.shopApi) {
  window.shopApi = createShopApi(async (channel, value) => {
    const response = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, value })
    })
    const payload: { result?: unknown; error?: string } = await response.json()
    if (!response.ok) {
      throw new Error(payload.error ?? 'The local database request failed')
    }
    return payload.result
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocalizationProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LocalizationProvider>
  </React.StrictMode>
)
