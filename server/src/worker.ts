import { createRuntime } from './runtime.js'

const { dispatcher } = createRuntime()

if (!dispatcher) {
  throw new Error('Agent dispatch worker requires executor configuration and dispatch repository support')
}

const workerDispatcher = dispatcher
workerDispatcher.start()
console.log('EasyDashboard Agent dispatch worker started')

let shuttingDown = false
const keepAlive = setInterval(() => undefined, 60_000)

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(keepAlive)
  console.log(`EasyDashboard Agent dispatch worker received ${signal}; shutting down`)
  await workerDispatcher.stop()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch(error => {
      console.error('EasyDashboard Agent dispatch worker shutdown failed', error)
      process.exitCode = 1
    })
  })
}
