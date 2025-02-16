import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Toggle',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Toggle',
      props: {},
      $dashboard: {
        rect: {
          width: 36,
          height: 36,
        },
      },
    },
  },
]

export default snippets
