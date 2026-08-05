import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const setupScript = readFileSync(new URL('../../../scripts/setup-agent-executor.mjs', import.meta.url), 'utf8')

describe('Agent executor local setup', () => {
  it('preserves the server-only Supabase key when regenerating executor configuration', () => {
    expect(setupScript).toContain('resolveExistingSupabaseSecretKey')
    expect(setupScript).toContain('SUPABASE_SECRET_KEY=')
    expect(setupScript).not.toContain('process.stdout.write(supabaseSecretKey')
  })
})
