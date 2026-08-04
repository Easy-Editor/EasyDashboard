import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const MODEL_PROFILE_SECRET_VERSION = 1 as const

export interface EncryptedModelProfileSecret {
  version: typeof MODEL_PROFILE_SECRET_VERSION
  algorithm: 'aes-256-gcm'
  iv: string
  ciphertext: string
  authTag: string
}

export class ModelProfileCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelProfileCryptoError'
  }
}

export function decodeModelProfileEncryptionKey(encodedKey: string): Buffer {
  let key: Buffer
  try {
    key = Buffer.from(encodedKey, 'base64')
  } catch {
    throw new ModelProfileCryptoError('Model profile encryption key must be valid base64')
  }
  if (key.length !== 32 || key.toString('base64').replaceAll('=', '') !== encodedKey.trim().replaceAll('=', '')) {
    throw new ModelProfileCryptoError('Model profile encryption key must decode to exactly 32 bytes')
  }
  return key
}

export function encryptModelProfileApiKey(input: {
  apiKey: string
  encryptionKey: string
  profileId: string
  iv?: Buffer
}): EncryptedModelProfileSecret {
  if (!input.apiKey) throw new ModelProfileCryptoError('Model profile API key cannot be empty')
  const key = decodeModelProfileEncryptionKey(input.encryptionKey)
  const iv = input.iv ?? randomBytes(12)
  if (iv.length !== 12) throw new ModelProfileCryptoError('AES-GCM IV must be exactly 12 bytes')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(input.profileId, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(input.apiKey, 'utf8'), cipher.final()])
  return {
    version: MODEL_PROFILE_SECRET_VERSION,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptModelProfileApiKey(input: {
  secret: EncryptedModelProfileSecret
  encryptionKey: string
  profileId: string
}): string {
  try {
    if (input.secret.version !== MODEL_PROFILE_SECRET_VERSION || input.secret.algorithm !== 'aes-256-gcm') {
      throw new Error('unsupported secret version')
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      decodeModelProfileEncryptionKey(input.encryptionKey),
      Buffer.from(input.secret.iv, 'base64'),
    )
    decipher.setAAD(Buffer.from(input.profileId, 'utf8'))
    decipher.setAuthTag(Buffer.from(input.secret.authTag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(input.secret.ciphertext, 'base64')), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    throw new ModelProfileCryptoError('Model profile API key could not be decrypted')
  }
}
