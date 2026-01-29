/**
 * DataCodeView - 代码视图
 * 使用 Monaco Editor 显示和编辑 JSON 数据
 */
import { useCallback, useMemo } from 'react'
import { CodeEditor } from '@/components/common/CodeEditor'
import styles from './styles.module.css'

interface DataCodeViewProps {
  data: unknown[]
  editable?: boolean
  onChange?: (data: unknown[]) => void
}

export const DataCodeView = (props: DataCodeViewProps) => {
  const { data, editable = false, onChange } = props

  // 将数据转换为 JSON 字符串
  const jsonString = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return '[]'
    }
  }, [data])

  // 处理代码变更
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!onChange || !value) return
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
          onChange(parsed)
        }
      } catch {
        // JSON 解析失败，忽略
      }
    },
    [onChange],
  )

  return (
    <div className={styles.codeWrapper}>
      <CodeEditor
        language='json'
        value={jsonString}
        onChange={handleChange}
        height='200px'
        options={{
          readOnly: !editable,
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          folding: true,
          tabSize: 2,
        }}
      />
    </div>
  )
}
