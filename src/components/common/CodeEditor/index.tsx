import { useDebounceFn } from '@/hooks/useDebounceFn'
import type { EditorProps, OnChange, OnMount } from '@monaco-editor/react'
import { Editor as MonacoEditor, loader } from '@monaco-editor/react'
import { type FC, useState } from 'react'
import { libType } from './lib'

loader.config({
  paths: {
    vs: '/monaco-editor/min/vs',
  },
})

// 初始化配置
const defaultOptions: EditorProps['options'] = {
  folding: false,
  lineNumbersMinChars: 3,
  lineNumbers: 'on',
  automaticLayout: true,
  acceptSuggestionOnEnter: 'smart',
  scrollbar: {
    verticalScrollbarSize: 0,
    verticalSliderSize: 4,
    horizontal: 'hidden',
    useShadows: false,
  },
  smoothScrolling: true,
  minimap: {
    enabled: false,
  },
  autoClosingBrackets: 'languageDefined',
  autoClosingQuotes: 'languageDefined',
  tabSize: 2,
}

export const CodeEditor: FC<EditorProps> = props => {
  const [theme, setTheme] = useState('vs-dark')

  // 处理代码修改， args需要做一层透传来完善防抖，避免触发重复构建
  const { run: handleChange } = useDebounceFn<OnChange>(
    (...args) => {
      if (props.onChange) {
        props.onChange(...args)
      }
    },
    {
      wait: 400,
    },
  )

  // 编辑器Mount钩子，需要注册一些事例
  const onEditorMount: OnMount = (_editor, _monaco) => {
    // 添加类型提示
    _monaco.languages.typescript.javascriptDefaults.addExtraLib(libType, 'lib.d.ts')

    if (props.onMount) {
      props.onMount(_editor, _monaco)
    }
  }

  return (
    <MonacoEditor
      loading={<span>loading</span>}
      theme={theme}
      {...props}
      onChange={handleChange}
      onMount={onEditorMount}
      options={{
        ...defaultOptions,
        ...props.options,
      }}
    />
  )
}
