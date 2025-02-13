import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { ThemeProvider } from './components/theme-provider'
import { simulator } from './editor'
import { AppLayout } from './layouts/app-layout'

function App() {
  return (
    <ThemeProvider defaultTheme='system' storageKey='easy-dashboard-theme'>
      <AppLayout>
        <SimulatorRenderer
          host={simulator}
          bemTools={{
            resizing: true,
          }}
        />
      </AppLayout>
    </ThemeProvider>
  )
}

export default App
