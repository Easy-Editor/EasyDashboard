import { createRuntime } from './runtime.js'

// Serverless instances enqueue durable work but never start an in-process poller.
const { app } = createRuntime()

export default {
  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request)
  },
}
