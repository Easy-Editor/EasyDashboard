import { serve } from '@hono/node-server'
import { parseEnv } from './env.js'
import { createRuntimeApp } from './runtime.js'

const env = parseEnv()
const app = createRuntimeApp()

serve({ fetch: app.fetch, port: env.PORT }, info => {
  console.log(`EasyDashboard API listening on http://localhost:${info.port}`)
})
