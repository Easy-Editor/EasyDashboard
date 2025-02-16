import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Progress',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Progress',
      props: {},
      $dashboard: {
        rect: {
          width: 400,
          height: 10,
        },
      },
    },
  },
]

export default snippets
