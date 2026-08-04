/**
 * 全局变量初始化
 * 将 React、ReactDOM、echarts 等暴露到 window 对象，供 UMD 组件使用
 */

import * as echartsCharts from 'echarts/charts'
import * as echartsComponents from 'echarts/components'
import * as echarts from 'echarts/core'
import * as echartsRenderers from 'echarts/renderers'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

/**
 * 初始化全局变量
 * 供远程物料（UMD 组件）使用
 */
export function initGlobals() {
  // 暴露 React 到全局
  if (typeof window !== 'undefined') {
    // React
    if (!window.React) {
      window.React = React
      console.log('[Globals] ✅ window.React exposed')
    }

    // ReactDOM
    if (!window.ReactDOM) {
      window.ReactDOM = ReactDOM
      console.log('[Globals] ✅ window.ReactDOM exposed')
    }

    // jsx-runtime（用于 runtime: 'automatic' 模式）
    if (!window.jsxRuntime && window.React) {
      window.jsxRuntime = {
        jsx,
        jsxs,
        Fragment,
      }
      console.log('[Globals] ✅ window.jsxRuntime exposed')
    }

    // ECharts 及其子模块（用于图表组件）
    if (!window.echarts) {
      // 合并所有 echarts 模块到一个对象
      const echartsAll = {
        ...echarts,
        ...echartsCharts,
        ...echartsComponents,
        ...echartsRenderers,
      }
      window.echarts = echartsAll
      // 同时暴露子模块路径，供开发模式下的虚拟模块使用
      window['echarts/core'] = echarts
      window['echarts/charts'] = echartsCharts
      window['echarts/components'] = echartsComponents
      window['echarts/renderers'] = echartsRenderers
      console.log('[Globals] ✅ window.echarts and submodules exposed')
    }
  }
}
