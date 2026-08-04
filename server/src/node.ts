import { serve } from '@hono/node-server'
import { parseEnv } from './env.js'
import { createRuntime } from './runtime.js'

const env = parseEnv()
const { app, dispatcher } = createRuntime()
dispatcher?.start()

const server = serve({ fetch: app.fetch, port: env.PORT }, info => {
  console.log(`EasyDashboard API listening on http://localhost:${info.port}`)
})

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`EasyDashboard API received ${signal}; shutting down`)

  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()))
  })
  await Promise.all([serverClosed, dispatcher?.stop()])
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch(error => {
      console.error('EasyDashboard API shutdown failed', error)
      process.exitCode = 1
    })
  })
}
