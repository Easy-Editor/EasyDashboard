import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Carousel',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Carousel',
      props: {},
      $dashboard: {
        rect: {
          width: 250,
          height: 250,
        },
      },
    },
  },
]

export default snippets
