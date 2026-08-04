export const MCP_POLICY_CONTRACT_VERSION = 'easy-dashboard.mcp-policy.v1' as const

export type McpToolEffect =
  | 'read'
  | 'external-write'
  | 'external-delete'
  | 'connection-change'
  | 'dependency-install'
  | 'publish'

export type McpToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  effect: McpToolEffect
  resource: string
  scopes: readonly string[]
  authorizationScope?: string
}

export type McpBinding = {
  contractVersion: typeof MCP_POLICY_CONTRACT_VERSION
  id: string
  projectId: string
  serverId: string
  serverUrl: string
  policyVersion: string
  enabled: boolean
  credentialRef: string
  tools: readonly McpToolDefinition[]
}

export type McpModelManifest = {
  contractVersion: typeof MCP_POLICY_CONTRACT_VERSION
  bindingId: string
  serverId: string
  policyVersion: string
  tools: Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    effect: McpToolEffect
    resource: string
    scopes: string[]
  }>
}

export type McpInvocationRequest = {
  projectId: string
  serverId: string
  toolName: string
  requestedScopes: readonly string[]
  actorRole: 'owner' | 'editor' | 'viewer'
  authorizationGrants?: readonly string[]
}

export type McpAuthorizationDecision =
  | {
      allowed: true
      tool: McpToolDefinition
      requiredAuthorizations: string[]
    }
  | {
      allowed: false
      code:
        | 'BINDING_DISABLED'
        | 'PROJECT_MISMATCH'
        | 'SERVER_MISMATCH'
        | 'TOOL_NOT_ALLOWLISTED'
        | 'SCOPE_NOT_ALLOWLISTED'
        | 'VIEWER_SIDE_EFFECT_FORBIDDEN'
        | 'EXPLICIT_AUTHORIZATION_REQUIRED'
      reason: string
      requiredAuthorizations: string[]
    }

export type McpPolicyErrorCode = 'INVALID_BINDING' | 'INSECURE_SERVER_URL' | 'DUPLICATE_TOOL'

export class McpPolicyError extends Error {
  constructor(
    public readonly code: McpPolicyErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'McpPolicyError'
  }
}

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const credentialReferencePattern = /^(?:env|secret|vault):\/\/[a-zA-Z0-9][a-zA-Z0-9/._:-]*$/
const forbiddenModelCredentialKeys = new Set([
  'apikey',
  'authorization',
  'bearertoken',
  'clientsecret',
  'cookie',
  'credential',
  'credentials',
  'password',
  'secret',
  'token',
])

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new McpPolicyError('INVALID_BINDING', `${label} must be a stable identifier`)
  }
}

function cloneTool(tool: McpToolDefinition): McpToolDefinition {
  return {
    ...tool,
    inputSchema: structuredClone(tool.inputSchema),
    scopes: [...tool.scopes],
  }
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

function assertCredentiallessModelSchema(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCredentiallessModelSchema(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenModelCredentialKeys.has(normalizedKey(key))) {
      throw new McpPolicyError(
        'INVALID_BINDING',
        `MCP model tool schema cannot request credential field ${path}.${key}`,
      )
    }
    assertCredentiallessModelSchema(child, `${path}.${key}`)
  }
}

export function createMcpBinding(
  input: Omit<McpBinding, 'contractVersion'> & { contractVersion?: typeof MCP_POLICY_CONTRACT_VERSION },
): McpBinding {
  assertIdentifier(input.id, 'Binding id')
  assertIdentifier(input.projectId, 'Project id')
  assertIdentifier(input.serverId, 'Server id')
  assertIdentifier(input.policyVersion, 'Policy version')
  if (!credentialReferencePattern.test(input.credentialRef)) {
    throw new McpPolicyError(
      'INVALID_BINDING',
      'MCP credentials must be held by an env://, secret://, or vault:// server-side reference',
    )
  }

  let endpoint: URL
  try {
    endpoint = new URL(input.serverUrl)
  } catch {
    throw new McpPolicyError('INSECURE_SERVER_URL', 'MCP server URL must be an absolute HTTPS URL')
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new McpPolicyError(
      'INSECURE_SERVER_URL',
      'MCP server URL must use HTTPS and cannot contain credentials or a fragment',
    )
  }

  const toolNames = new Set<string>()
  const tools = input.tools.map(tool => {
    assertIdentifier(tool.name, 'Tool name')
    if (!tool.description.trim() || !tool.resource.trim()) {
      throw new McpPolicyError('INVALID_BINDING', `MCP tool ${tool.name} requires a description and resource`)
    }
    assertCredentiallessModelSchema(tool.inputSchema, `tools.${tool.name}.inputSchema`)
    if (toolNames.has(tool.name)) {
      throw new McpPolicyError('DUPLICATE_TOOL', `Duplicate MCP tool allowlist entry: ${tool.name}`)
    }
    toolNames.add(tool.name)
    const scopes = new Set(tool.scopes)
    if (scopes.size !== tool.scopes.length || tool.scopes.some(scope => !scope.trim())) {
      throw new McpPolicyError('INVALID_BINDING', `MCP tool ${tool.name} contains invalid or duplicate scopes`)
    }
    if (tool.effect !== 'read' && !tool.authorizationScope?.trim()) {
      throw new McpPolicyError(
        'INVALID_BINDING',
        `Side-effecting MCP tool ${tool.name} must declare an explicit authorization scope`,
      )
    }
    return cloneTool(tool)
  })

  return {
    contractVersion: MCP_POLICY_CONTRACT_VERSION,
    id: input.id,
    projectId: input.projectId,
    serverId: input.serverId,
    serverUrl: endpoint.toString(),
    policyVersion: input.policyVersion,
    enabled: input.enabled,
    credentialRef: input.credentialRef,
    tools,
  }
}

export function createMcpModelManifest(binding: McpBinding): McpModelManifest {
  return {
    contractVersion: MCP_POLICY_CONTRACT_VERSION,
    bindingId: binding.id,
    serverId: binding.serverId,
    policyVersion: binding.policyVersion,
    tools: binding.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
      effect: tool.effect,
      resource: tool.resource,
      scopes: [...tool.scopes],
    })),
  }
}

function denied(
  code: Exclude<McpAuthorizationDecision, { allowed: true }>['code'],
  reason: string,
  requiredAuthorizations: string[] = [],
): McpAuthorizationDecision {
  return { allowed: false, code, reason, requiredAuthorizations }
}

export function evaluateMcpInvocation(binding: McpBinding, request: McpInvocationRequest): McpAuthorizationDecision {
  if (!binding.enabled) return denied('BINDING_DISABLED', 'MCP binding is disabled')
  if (request.projectId !== binding.projectId) {
    return denied('PROJECT_MISMATCH', 'MCP binding does not belong to the requested project')
  }
  if (request.serverId !== binding.serverId) {
    return denied('SERVER_MISMATCH', 'MCP server is not allowlisted by this binding')
  }
  const tool = binding.tools.find(candidate => candidate.name === request.toolName)
  if (!tool) return denied('TOOL_NOT_ALLOWLISTED', 'MCP tool is not allowlisted by this binding')

  const allowedScopes = new Set(tool.scopes)
  const disallowedScope = request.requestedScopes.find(scope => !allowedScopes.has(scope))
  if (disallowedScope) {
    return denied('SCOPE_NOT_ALLOWLISTED', `MCP scope is not allowlisted: ${disallowedScope}`)
  }

  if (tool.effect === 'read') {
    return { allowed: true, tool: cloneTool(tool), requiredAuthorizations: [] }
  }
  if (request.actorRole === 'viewer') {
    return denied('VIEWER_SIDE_EFFECT_FORBIDDEN', 'Viewer role cannot invoke side-effecting MCP tools')
  }

  const requiredAuthorizations = [`mcp.invoke:${binding.serverId}/${tool.name}`, tool.authorizationScope as string]
  const grants = new Set(request.authorizationGrants ?? [])
  const missing = requiredAuthorizations.filter(scope => !grants.has(scope))
  if (missing.length > 0) {
    return denied(
      'EXPLICIT_AUTHORIZATION_REQUIRED',
      `Side-effecting MCP tool requires explicit authorization: ${missing.join(', ')}`,
      requiredAuthorizations,
    )
  }

  return { allowed: true, tool: cloneTool(tool), requiredAuthorizations }
}

export function assertMcpInvocationAuthorized(binding: McpBinding, request: McpInvocationRequest): McpToolDefinition {
  const decision = evaluateMcpInvocation(binding, request)
  if (!decision.allowed) {
    throw new McpPolicyError('INVALID_BINDING', `${decision.code}: ${decision.reason}`)
  }
  return decision.tool
}
