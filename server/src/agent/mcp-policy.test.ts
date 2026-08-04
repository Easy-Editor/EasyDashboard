import { describe, expect, it } from 'vitest'
import { type McpPolicyError, createMcpBinding, createMcpModelManifest, evaluateMcpInvocation } from './mcp-policy.js'

function binding() {
  return createMcpBinding({
    id: 'binding-1',
    projectId: 'project-1',
    serverId: 'warehouse',
    serverUrl: 'https://mcp.example.com/rpc',
    policyVersion: 'policy-1',
    enabled: true,
    credentialRef: 'vault://projects/project-1/mcp/warehouse',
    tools: [
      {
        name: 'schema.read',
        description: '读取已授权的数据结构。',
        inputSchema: { type: 'object', properties: { table: { type: 'string' } } },
        effect: 'read',
        resource: 'warehouse-main',
        scopes: ['schema:read'],
      },
      {
        name: 'row.write',
        description: '写入一条外部记录。',
        inputSchema: { type: 'object', properties: { row: { type: 'object' } } },
        effect: 'external-write',
        resource: 'warehouse-main',
        scopes: ['row:write'],
        authorizationScope: 'external.write:warehouse-main',
      },
    ],
  })
}

describe('MCP policy', () => {
  it('requires a credential-free HTTPS endpoint', () => {
    expect(() =>
      createMcpBinding({
        ...binding(),
        serverUrl: 'http://user:password@mcp.example.com/rpc',
      }),
    ).toThrowError(expect.objectContaining<Partial<McpPolicyError>>({ code: 'INSECURE_SERVER_URL' }))
  })

  it('allows only the bound server, tool, project, and scopes', () => {
    expect(
      evaluateMcpInvocation(binding(), {
        projectId: 'project-1',
        serverId: 'warehouse',
        toolName: 'schema.read',
        requestedScopes: ['schema:read'],
        actorRole: 'viewer',
      }),
    ).toMatchObject({ allowed: true })

    expect(
      evaluateMcpInvocation(binding(), {
        projectId: 'project-1',
        serverId: 'warehouse',
        toolName: 'admin.execute',
        requestedScopes: [],
        actorRole: 'owner',
      }),
    ).toMatchObject({ allowed: false, code: 'TOOL_NOT_ALLOWLISTED' })
  })

  it('requires both exact MCP invocation and resource authorization for external side effects', () => {
    const request = {
      projectId: 'project-1',
      serverId: 'warehouse',
      toolName: 'row.write',
      requestedScopes: ['row:write'],
      actorRole: 'editor' as const,
    }

    expect(evaluateMcpInvocation(binding(), request)).toMatchObject({
      allowed: false,
      code: 'EXPLICIT_AUTHORIZATION_REQUIRED',
      requiredAuthorizations: ['mcp.invoke:warehouse/row.write', 'external.write:warehouse-main'],
    })
    expect(
      evaluateMcpInvocation(binding(), {
        ...request,
        authorizationGrants: ['mcp.invoke:warehouse/row.write', 'external.write:warehouse-main'],
      }),
    ).toMatchObject({ allowed: true })
  })

  it('never places server URL or credential references in the model manifest', () => {
    const manifest = createMcpModelManifest(binding())
    const serialized = JSON.stringify(manifest)

    expect(serialized).not.toContain('vault://')
    expect(serialized).not.toContain('mcp.example.com')
    expect(manifest.tools.map(tool => tool.name)).toEqual(['schema.read', 'row.write'])
  })

  it('rejects credential material disguised as model-visible tool input', () => {
    expect(() =>
      createMcpBinding({
        ...binding(),
        tools: [
          {
            name: 'unsafe.read',
            description: '不安全工具',
            inputSchema: { type: 'object', properties: { apiKey: { type: 'string' } } },
            effect: 'read',
            resource: 'warehouse-main',
            scopes: ['schema:read'],
          },
        ],
      }),
    ).toThrowError(expect.objectContaining<Partial<McpPolicyError>>({ code: 'INVALID_BINDING' }))
  })
})
