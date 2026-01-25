/**
 * 检查事件是否由表单元素触发
 * 用于避免在输入框中触发快捷键
 */
export const isFormEvent = (e: KeyboardEvent | MouseEvent): boolean => {
  const target = e.target as HTMLElement
  if (!target) return false

  // 检查是否为表单元素
  if (target instanceof HTMLFormElement) return true
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return true

  // 检查是否为可编辑元素
  if (target.isContentEditable) return true

  // 检查 Monaco Editor 等代码编辑器
  if (target.closest('.monaco-editor')) return true

  return false
}
