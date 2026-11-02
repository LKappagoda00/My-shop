import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const checks = await Promise.allSettled([
    fetch('http://127.0.0.1:5174/', { signal: AbortSignal.timeout(1000) }),
    fetch('http://127.0.0.1:4317/api/health', { signal: AbortSignal.timeout(1000) })
  ])
  const failures = checks.filter((check) => check.status === 'rejected')
  const unexpectedFailure = failures.find(({ reason }) => {
    if (reason instanceof DOMException && ['AbortError', 'TimeoutError'].includes(reason.name)) {
      return false
    }
    return !(
      reason instanceof TypeError
      && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(reason.cause?.code)
    )
  })

  if (unexpectedFailure) {
    throw unexpectedFailure.reason
  }

  if (failures.length === 0) {
    const [webResponse, apiResponse] = checks.map((check) => check.value)
    const [page, health] = await Promise.all([webResponse.text(), apiResponse.json()])
    if (webResponse.ok && page.includes('<title>My Shop POS</title>') && health.ok === true) {
      console.log('My Shop is already running at http://127.0.0.1:5174/')
      process.exit(0)
    }
  }
} catch (error) {
  console.error('Could not check whether My Shop is already running:', error)
  process.exit(1)
}

const tsc = resolve(root, 'node_modules/typescript/bin/tsc')
const compiled = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.server.json'], {
  cwd: root,
  stdio: 'inherit'
})

if (compiled.status !== 0) {
  process.exit(compiled.status ?? 1)
}

const processes = [
  spawn(process.execPath, ['out/server/electron/local-server.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.local.config.ts'], {
    cwd: root,
    stdio: 'inherit'
  })
]
let shuttingDown = false

function stopProcesses(signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of processes) {
    if (child.exitCode === null) child.kill(signal)
  }
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error('Could not start the local app:', error)
    stopProcesses()
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.exitCode = code ?? 1
      stopProcesses()
    }
  })
}

process.once('SIGINT', () => stopProcesses('SIGINT'))
process.once('SIGTERM', () => stopProcesses('SIGTERM'))
