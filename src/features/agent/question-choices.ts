export function resolveQuestionChoices(prompt: string): string[] {
  const normalized = prompt.trim().replace(/[？?。.]$/, '')
  const alternatives = normalized.split(/\s*[，,、]?\s*还是\s*/).map(value => value.trim())
  if (alternatives.length === 2 && alternatives.every(value => value.length > 0 && value.length <= 32)) {
    return alternatives
  }
  if (/是否|要不要|需不需要|能否|可否/.test(normalized)) {
    return ['确认，按此继续', '不，保持当前状态']
  }
  return ['按 Agent 建议继续', '我需要补充说明']
}
