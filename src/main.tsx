import { createRoot } from 'react-dom/client'
import { scan } from 'react-scan'
import './styles/global.css'
import App from './App'

if (typeof window !== 'undefined') {
  scan({
    enabled: true,
    log: false,
  })
}

createRoot(document.getElementById('root')!).render(<App />)
