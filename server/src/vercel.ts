import { createRuntimeApp } from './runtime.js'

const app = createRuntimeApp()

export default {
  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request)
  },
}
