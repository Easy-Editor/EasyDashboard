import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Text',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Text',
      props: {
        text: 'Text Text Text',
      },
      $dashboard: {
        rect: {
          width: 120,
          height: 40,
        },
      },
    },
  },
]

export default snippets
