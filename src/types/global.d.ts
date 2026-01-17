declare global {
  interface Window {
    React?: typeof import('react')

    ReactDOM?: typeof import('react-dom')

    jsxRuntime?: {
      jsx: typeof import('react').createElement
      jsxs: typeof import('react').createElement
      Fragment: typeof import('react').Fragment
    }

    $EasyEditor?: Record<string, unknown>
  }
}
