import type { PluginCreator } from '@easy-editor/core'

const ExamplePlugin: PluginCreator = () => {
  return {
    name: 'ExamplePlugin',
    deps: [],
    init(ctx) {
      ctx.logger.log('打个日志', ctx)

      ctx.project.set('example', {
        aaa: 'bbb',
      })
    },
  }
}

export default ExamplePlugin
