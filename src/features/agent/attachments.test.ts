import { describe, expect, it } from 'vitest'
import {
  AGENT_ATTACHMENT_ACCEPT,
  AGENT_DATA_ATTACHMENT_ACCEPT,
  AGENT_REFERENCE_ATTACHMENT_ACCEPT,
  agentAttachmentContentType,
  isSupportedAgentAttachment,
} from './attachments'

describe('Agent attachment format contract', () => {
  it('matches the backend image, PDF, text, Markdown, CSV, and XLSX allowlist', () => {
    expect(AGENT_ATTACHMENT_ACCEPT).toContain('.xlsx')
    expect(AGENT_ATTACHMENT_ACCEPT).not.toMatch(/\.json|\.docx?|\.xls(?:,|$)/)
    expect(AGENT_REFERENCE_ATTACHMENT_ACCEPT).toContain('.png')
    expect(AGENT_REFERENCE_ATTACHMENT_ACCEPT).toContain('.pdf')
    expect(AGENT_REFERENCE_ATTACHMENT_ACCEPT).not.toContain('.csv')
    expect(AGENT_DATA_ATTACHMENT_ACCEPT).toContain('.csv')
    expect(AGENT_DATA_ATTACHMENT_ACCEPT).toContain('.xlsx')
    expect(AGENT_DATA_ATTACHMENT_ACCEPT).not.toContain('.png')
    expect(isSupportedAgentAttachment({ name: '需求.md', type: '' })).toBe(true)
    expect(agentAttachmentContentType({ name: '需求.md', type: '' })).toBe('text/markdown')
    expect(agentAttachmentContentType({ name: '数据.xlsx', type: '' })).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(isSupportedAgentAttachment({ name: '旧需求.docx', type: '' })).toBe(false)
  })
})
