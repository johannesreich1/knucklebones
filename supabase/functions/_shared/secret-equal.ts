/* Constant-time comparison for shared-secret headers. A plain !== short-
   circuits on the first differing character, which leaks a timing oracle for
   the secret. Hashing both sides first makes the byte comparison fixed-length,
   so neither content nor length leaks. Callers keep their fail-closed guard
   for an unset secret — this only replaces the equality itself. */
export async function secretEquals(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
