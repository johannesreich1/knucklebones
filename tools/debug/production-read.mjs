// Narrow transport for production diagnostics. Callers own fixed, reviewed
// SELECT queries; this module only supplies the configured project and a
// credential without ever accepting or printing a token on the command line.
import { execFileSync } from 'node:child_process';
import { SUPABASE_PROJECT_REF } from '../../src/config.ts';

const READ_ONLY_ENDPOINT = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query/read-only`;

function accessToken() {
  const environmentToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (environmentToken) return environmentToken;

  if (process.platform !== 'darwin') {
    throw new Error('Set SUPABASE_ACCESS_TOKEN; the Keychain fallback is available only on macOS.');
  }

  try {
    const token = execFileSync('/usr/bin/security', [
      'find-generic-password',
      '-s', 'Supabase CLI',
      '-a', 'supabase',
      '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (token) return token;
  } catch {
    // Replace Keychain's command details with an actionable, secret-free error.
  }
  throw new Error('No Supabase token found. Sign in with the CLI or set SUPABASE_ACCESS_TOKEN.');
}

export async function productionRead(query, parameters = []) {
  const response = await fetch(READ_ONLY_ENDPOINT, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, parameters }),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { body = null; }

  if (!response.ok) {
    const detail = typeof body?.message === 'string' ? `: ${body.message}` : '';
    throw new Error(`Supabase read-only query failed (${response.status})${detail}`);
  }
  if (!Array.isArray(body)) throw new Error('Supabase read-only query returned an unexpected response.');
  return body;
}
