import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { openShopDatabase } from '../database'
import { registerShopHandlers, removeShopHandlers } from '../database/register-handlers'

let mainWindow: BrowserWindow | undefined
let closeDatabase: (() => void) | undefined

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = window

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:get-version', () => app.getVersion())

app.whenReady().then(() => {
  const database = openShopDatabase(app.getPath('userData'))
  closeDatabase = () => database.close()
  registerShopHandlers(database, () => mainWindow?.webContents, ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox('My Shop POS could not start', detail)
  app.quit()
})

app.on('before-quit', () => {
  removeShopHandlers(ipcMain)
  closeDatabase?.()
  closeDatabase = undefined
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
