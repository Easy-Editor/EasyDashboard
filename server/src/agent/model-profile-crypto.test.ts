import { describe, expect, it } from 'vitest'
import {
  ModelProfileCryptoError,
  decryptModelProfileApiKey,
  encryptModelProfileApiKey,
} from './model-profile-crypto.js'

const encryptionKey = Buffer.alloc(32, 7).toString('base64')

describe('model profile API key encryption', () => {
  it('round-trips an API key with AES-256-GCM without storing plaintext', () => {
    const secret = encryptModelProfileApiKey({
      apiKey: 'sk-private-user-key',
      encryptionKey,
      profileId: 'profile-1',
      iv: Buffer.alloc(12, 3),
    })

    expect(secret).toMatchObject({ version: 1, algorithm: 'aes-256-gcm' })
    expect(JSON.stringify(secret)).not.toContain('sk-private-user-key')
    expect(decryptModelProfileApiKey({ secret, encryptionKey, profileId: 'profile-1' })).toBe('sk-private-user-key')
  })

  it('binds ciphertext to the profile id and rejects tampering', () => {
    const secret = encryptModelProfileApiKey({
      apiKey: 'sk-private-user-key',
      encryptionKey,
      profileId: 'profile-1',
    })

    expect(() => decryptModelProfileApiKey({ secret, encryptionKey, profileId: 'another-profile' })).toThrowError(
      expect.objectContaining<Partial<ModelProfileCryptoError>>({ name: 'ModelProfileCryptoError' }),
    )
    expect(() =>
      decryptModelProfileApiKey({
        secret: { ...secret, ciphertext: Buffer.from('tampered').toString('base64') },
        encryptionKey,
        profileId: 'profile-1',
      }),
    ).toThrow(ModelProfileCryptoError)
  })

  it('rejects encryption keys that are not exactly 256 bits', () => {
    expect(() =>
      encryptModelProfileApiKey({ apiKey: 'key', encryptionKey: Buffer.alloc(16).toString('base64'), profileId: 'p' }),
    ).toThrow('exactly 32 bytes')
  })
})
