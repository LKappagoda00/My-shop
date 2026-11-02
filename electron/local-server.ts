import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openShopDatabase } from './database'
import { registerShopHandlers, removeShopHandlers } from './database/register-handlers'
import type { IpcHandlerRegistry, IpcRequestHandler } from './database/handler-registry'

const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 4317)
const trustedSender = {}
const handlers = new Map<string, IpcRequestHandler>()

const registry: IpcHandlerRegistry = {
  handle(channel, handler) {
    handlers.set(channel, handler)
  },
  removeHandler(channel) {
    handlers.delete(channel)
  }
}

const dataDirectory = join(
  process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
  'my-shop-pos'
)
const database = openShopDatabase(dataDirectory)
registerShopHandlers(database, () => trustedSender, registry)
handlers.set('app:get-version', () => '0.1.0')

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method !== 'POST' || request.url !== '/api/invoke') {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk: string) => {
    body += chunk
    if (body.length > 4_000_000) {
      sendJson(response, 413, { error: 'Request is too large' })
      request.destroy()
    }
  })
  request.on('end', () => {
    try {
      const payload: unknown = JSON.parse(body)
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        sendJson(response, 400, { error: 'Invalid request body' })
        return
      }

      const { channel, value } = payload as { channel?: unknown; value?: unknown }
      if (typeof channel !== 'string') {
        sendJson(response, 400, { error: 'A request channel is required' })
        return
      }

      const handler = handlers.get(channel)
      if (!handler) {
        sendJson(response, 404, { error: 'Unknown operation' })
        return
      }

      Promise.resolve(handler({ sender: trustedSender }, value)).then(
        (result) => sendJson(response, 200, { result }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : 'The local operation failed'
          sendJson(response, 400, { error: message })
        }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON request'
      sendJson(response, 400, { error: message })
    }
  })
})

server.on('error', (error) => {
  console.error('Local database server failed:', error)
  database.close()
  process.exitCode = 1
})

server.listen(port, host, () => {
  console.log(`My Shop local server: http://${host}:${port}`)
  console.log(`SQLite database: ${join(dataDirectory, 'shop.sqlite')}`)
})

function shutdown(): void {
  server.close(() => {
    removeShopHandlers(registry)
    database.close()
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
