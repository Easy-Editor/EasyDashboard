import { isIP } from 'node:net'

export type ModelProfileProvider = 'platform' | 'openai-compatible'
export type ModelBillingScope = 'project' | 'user'
export type ModelProfileStatus = 'unverified' | 'probing' | 'active' | 'failed'

export interface ModelCapabilities {
  vision: boolean
  toolCalling: boolean
  structuredOutput: boolean
}

export interface ModelProfileSecret {
  apiKey: string
}

export interface ModelProfile {
  id: string
  ownerId: string
  projectId: string | null
  provider: ModelProfileProvider
  endpoint: string
  model: string
  billingScope: ModelBillingScope
  fallbackToPlatform: boolean
  status: ModelProfileStatus
  capabilities: ModelCapabilities | null
  secret: ModelProfileSecret | null
  createdAt: string
  updatedAt: string
}

export interface ModelProfileManifest {
  id: string
  provider: ModelProfileProvider
  endpointOrigin: string
  model: string
  billingScope: ModelBillingScope
  fallbackToPlatform: boolean
  capabilities: ModelCapabilities | null
}

export type ModelSelection =
  | { kind: 'selected'; profile: ModelProfile; source: 'user' | 'platform' }
  | { kind: 'unavailable'; code: 'CUSTOM_PROFILE_UNAVAILABLE' | 'PLATFORM_PROFILE_UNAVAILABLE' }

export class ModelProfileError extends Error {
  constructor(
    readonly code: 'INVALID_ENDPOINT' | 'PRIVATE_ENDPOINT' | 'PROFILE_NOT_ACTIVE' | 'CAPABILITY_PROBE_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'ModelProfileError'
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal'])
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(part => Number(part))
  return octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : null
}

function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address)
  if (!octets) return true
  const value =
    ((((octets[0] as number) << 24) >>> 0) +
      ((octets[1] as number) << 16) +
      ((octets[2] as number) << 8) +
      (octets[3] as number)) >>>
    0
  const inCidr = (network: number, prefix: number) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return (value & mask) >>> 0 === (network & mask) >>> 0
  }
  return [
    [0x00000000, 8],
    [0x0a000000, 8],
    [0x64400000, 10],
    [0x7f000000, 8],
    [0xa9fe0000, 16],
    [0xac100000, 12],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc0586300, 24],
    [0xc0a80000, 16],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 4],
    [0xf0000000, 4],
  ].some(([network, prefix]) => inCidr(network as number, prefix as number))
}

function normalizeIpv6(address: string): string {
  const zoneIndex = address.indexOf('%')
  return (zoneIndex === -1 ? address : address.slice(0, zoneIndex)).toLowerCase()
}

function ipv6Hextets(address: string): number[] | null {
  let normalized = normalizeIpv6(address)
  const ipv4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  if (ipv4) {
    const octets = parseIpv4(ipv4[2] as string)
    if (!octets) return null
    normalized = `${ipv4[1]}${(((octets[0] as number) << 8) | (octets[1] as number)).toString(16)}:${(
      ((octets[2] as number) << 8) | (octets[3] as number)
    ).toString(16)}`
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const values = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map(value =>
    Number.parseInt(value, 16),
  )
  return values.length === 8 && values.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? values
    : null
}

function isBlockedIpv6(address: string): boolean {
  const parts = ipv6Hextets(address)
  if (!parts) return true
  const [a = 0, b = 0] = parts
  if ((a & 0xe000) !== 0x2000) return true
  if (a === 0x2001 && b < 0x0200) return true
  if (a === 0x2001 && b === 0x0db8) return true
  if (a === 0x2002) return true
  if (a === 0x3fff && (b & 0xf000) === 0) return true
  return false
}

export function isPublicNetworkAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return !isBlockedIpv4(address)
  if (version === 6) return !isBlockedIpv6(address)
  return false
}

export function assertPublicResolvedAddresses(addresses: readonly string[]): void {
  if (addresses.length === 0 || addresses.some(address => !isPublicNetworkAddress(address))) {
    throw new ModelProfileError('PRIVATE_ENDPOINT', 'Model endpoint must resolve only to public network addresses')
  }
}

export function normalizeCustomModelEndpoint(rawEndpoint: string): URL {
  let endpoint: URL
  try {
    endpoint = new URL(rawEndpoint)
  } catch {
    throw new ModelProfileError('INVALID_ENDPOINT', 'Model endpoint is not a valid URL')
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  ) {
    throw new ModelProfileError('INVALID_ENDPOINT', 'Custom model endpoint must be a credential-free public HTTPS URL')
  }
  if (isIP(hostname) && !isPublicNetworkAddress(hostname)) {
    throw new ModelProfileError('PRIVATE_ENDPOINT', 'Model endpoint cannot target a private or reserved address')
  }
  endpoint.search = ''
  return endpoint
}

export function hasRequiredAgentCapabilities(
  capabilities: ModelCapabilities | null,
): capabilities is ModelCapabilities {
  return Boolean(capabilities?.vision && capabilities.toolCalling && capabilities.structuredOutput)
}

export function activateModelProfile(profile: ModelProfile, capabilities: ModelCapabilities): ModelProfile {
  if (!hasRequiredAgentCapabilities(capabilities)) {
    throw new ModelProfileError(
      'CAPABILITY_PROBE_FAILED',
      'Model profile requires image understanding, tool calling, and structured output',
    )
  }
  return {
    ...profile,
    status: 'active',
    capabilities,
    updatedAt: new Date().toISOString(),
  }
}

function isActive(profile: ModelProfile | null | undefined): boolean {
  return Boolean(profile && profile.status === 'active' && hasRequiredAgentCapabilities(profile.capabilities))
}

export function selectModelProfile(input: {
  customProfile?: ModelProfile | null
  platformProfile?: ModelProfile | null
}): ModelSelection {
  const { customProfile, platformProfile } = input
  if (customProfile) {
    if (isActive(customProfile)) return { kind: 'selected', profile: customProfile, source: 'user' }
    if (!customProfile.fallbackToPlatform) {
      return { kind: 'unavailable', code: 'CUSTOM_PROFILE_UNAVAILABLE' }
    }
  }
  if (platformProfile && isActive(platformProfile)) {
    return { kind: 'selected', profile: platformProfile, source: 'platform' }
  }
  return { kind: 'unavailable', code: 'PLATFORM_PROFILE_UNAVAILABLE' }
}

export function toModelProfileManifest(profile: ModelProfile): ModelProfileManifest {
  const endpoint =
    profile.provider === 'openai-compatible'
      ? normalizeCustomModelEndpoint(profile.endpoint)
      : new URL(profile.endpoint)
  return {
    id: profile.id,
    provider: profile.provider,
    endpointOrigin: endpoint.origin,
    model: profile.model,
    billingScope: profile.billingScope,
    fallbackToPlatform: profile.fallbackToPlatform,
    capabilities: profile.capabilities,
  }
}
