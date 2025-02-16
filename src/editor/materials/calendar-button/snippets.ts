import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'CalendarButton',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'CalendarButton',
      props: {},
      $dashboard: {
        rect: {
          width: 280,
          height: 40,
        },
      },
    },
  },
]

export default snippets
