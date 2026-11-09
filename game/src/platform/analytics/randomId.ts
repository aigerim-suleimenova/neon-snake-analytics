const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A random 22-character ID (132 bits) of letters, digits, `-` and `_`, safe for the backend's
 * ID pattern. Uses `crypto.getRandomValues`, which, unlike `randomUUID`, also works outside secure contexts.
 */
export const randomId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
};
