import { ThemeProvider } from './components/theme-provider'
import { AppLayout } from './layouts/app-layout'

function App() {
  return (
    <ThemeProvider defaultTheme='system' storageKey='easy-dashboard-theme'>
      <AppLayout>
        <div>test</div>
      </AppLayout>
    </ThemeProvider>
  )
}

export default App
