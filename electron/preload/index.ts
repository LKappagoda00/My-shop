import { contextBridge, ipcRenderer } from 'electron'
import { createShopApi } from '../../src/shared/shop-api'

const shopApi = createShopApi((channel, value) => ipcRenderer.invoke(channel, value))

contextBridge.exposeInMainWorld('shopApi', shopApi)
