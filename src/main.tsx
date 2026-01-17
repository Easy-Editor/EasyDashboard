import { createRoot } from 'react-dom/client'
import { scan } from 'react-scan'
import App from './App'
import { initGlobals } from './globals'

import './styles/global.css'

// 初始化全局变量（供 UMD 组件使用）
initGlobals()

if (typeof window !== 'undefined') {
  scan({
    enabled: true,
    log: false,
  })
}

createRoot(document.getElementById('root')!).render(<App />)
