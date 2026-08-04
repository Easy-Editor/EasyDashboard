import { createRuntime } from './runtime.js'

const { dispatcher, taskOrchestrator } = createRuntime()

if (!dispatcher && !taskOrchestrator) {
  throw new Error('Agent dispatch worker requires executor configuration and dispatch repository support')
}

dispatcher?.start()
taskOrchestrator?.start()
console.log('EasyDashboard Agent workers started')

let shuttingDown = false
const keepAlive = setInterval(() => undefined, 60_000)

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(keepAlive)
  console.log(`EasyDashboard Agent dispatch worker received ${signal}; shutting down`)
  await Promise.all([dispatcher?.stop(), taskOrchestrator?.stop()])
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch(error => {
      console.error('EasyDashboard Agent dispatch worker shutdown failed', error)
      process.exitCode = 1
    })
  })
}
