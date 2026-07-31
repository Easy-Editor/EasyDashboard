import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { initGlobals } from './globals'

import './styles/global.css'

// 初始化全局变量（供 UMD 组件使用）
initGlobals()

if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_REACT_SCAN === 'true') {
  void import('react-scan').then(({ scan }) => {
    scan({
      enabled: true,
      log: false,
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
)
