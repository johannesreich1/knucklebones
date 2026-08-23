// UUIDv4 command/nonces for browsers down to the iOS 14 deployment target.
// `crypto.randomUUID()` arrived later there; getRandomValues is available and
// provides the same cryptographic entropy once the version/variant bits are set.
export type RandomValues = (bytes: Uint8Array<ArrayBuffer>) => void;

export function randomUuid(
  randomValues: RandomValues = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = new Uint8Array(16);
  randomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}`
    + `-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
