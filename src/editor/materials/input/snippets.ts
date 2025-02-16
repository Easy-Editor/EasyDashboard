import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Input',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Input',
      props: {},
      $dashboard: {
        rect: {
          width: 250,
          height: 40,
        },
      },
    },
  },
]

export default snippets
