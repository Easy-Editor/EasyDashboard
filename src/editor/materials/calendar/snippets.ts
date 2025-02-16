import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Calendar',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Calendar',
      props: {},
      $dashboard: {
        rect: {
          width: 250,
          height: 280,
        },
      },
    },
  },
]

export default snippets
