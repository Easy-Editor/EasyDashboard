const SHORT_HEX_PATTERN = /^#([\da-f])([\da-f])([\da-f])(?:[\da-f])?$/i
const LONG_HEX_PATTERN = /^#[\da-f]{6}(?:[\da-f]{2})?$/i

/**
 * Native color inputs only accept six-digit hexadecimal values. Keep richer
 * CSS values in the text field, but derive a safe preview value for the native
 * picker.
 */
export function toNativeColorValue(value: string | undefined): string {
  const normalized = value?.trim()
  if (!normalized) return '#000000'

  const shortMatch = normalized.match(SHORT_HEX_PATTERN)
  if (shortMatch) {
    return `#${shortMatch
      .slice(1, 4)
      .map(channel => `${channel}${channel}`)
      .join('')}`.toLowerCase()
  }

  if (LONG_HEX_PATTERN.test(normalized)) {
    return normalized.slice(0, 7).toLowerCase()
  }

  return '#000000'
}
