// Narrow rollout classifiers for PostgREST schema-cache errors. A failed
// request is not evidence of an old schema unless the server names one of the
// exact additive columns and uses a missing-column code.
function errorText(error: Record<string, unknown>): string {
  return [error.message, error.details]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

export function isMissingPostgrestColumn(
  error: unknown,
  expectedColumns: readonly string[],
): boolean {
  if (!error || typeof error !== 'object' || Array.isArray(error)
      || !expectedColumns.length) return false;
  const row = error as Record<string, unknown>;
  const text = errorText(row);
  if (row.code === 'PGRST204') {
    return expectedColumns.some((column) =>
      text.includes(`'${column}' column`) || text.includes(`column '${column}'`));
  }
  return row.code === '42703' && /does not exist/iu.test(text)
    && expectedColumns.some((column) => text.includes(column));
}

/** Missing-RPC compatibility is just as narrow as missing-column fallback:
 * an outage/permission error may never impersonate an older deployment. */
export function isMissingPostgrestRpc(error: unknown, rpcName: string): boolean {
  if (!error || typeof error !== 'object' || Array.isArray(error) || !rpcName.length) return false;
  const row = error as Record<string, unknown>;
  return (row.code === 'PGRST202' || row.code === '42883')
    && errorText(row).toLowerCase().includes(rpcName.toLowerCase());
}
