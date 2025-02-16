import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Table',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Table',
      props: {},
      $dashboard: {
        rect: {
          width: 750,
          height: 350,
        },
      },
    },
  },
]

export default snippets
