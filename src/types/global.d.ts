declare global {
  interface Window {
    React?: typeof import('react')

    ReactDOM?: typeof import('react-dom')

    jsxRuntime?: {
      jsx: typeof import('react/jsx-runtime').jsx
      jsxs: typeof import('react/jsx-runtime').jsxs
      Fragment: typeof import('react/jsx-runtime').Fragment
    }

    echarts?: typeof import('echarts/core') &
      typeof import('echarts/charts') &
      typeof import('echarts/components') &
      typeof import('echarts/renderers')

    'echarts/core'?: typeof import('echarts/core')
    'echarts/charts'?: typeof import('echarts/charts')
    'echarts/components'?: typeof import('echarts/components')
    'echarts/renderers'?: typeof import('echarts/renderers')

    $EasyEditor?: Record<string, unknown>
  }
}

export {}
