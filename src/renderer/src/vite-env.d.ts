/// <reference types="vite/client" />

import type { ShopApi } from '../../shared/shop-api'

declare global {
  interface Window {
    shopApi?: ShopApi
  }
}

export {}
