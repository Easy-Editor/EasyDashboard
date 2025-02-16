import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Select',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Select',
      props: {},
      $dashboard: {
        rect: {
          width: 180,
          height: 30,
        },
      },
    },
  },
]

export default snippets
