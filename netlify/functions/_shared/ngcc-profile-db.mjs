// NGCC — shared Supabase helper for the business capability profile intake,
// ported from NAT-CORP's netlify/functions/_shared/natcorp-db.mjs
// (2026-08-16, Registered Federal Contractors Portal merge).
//
// Deliberately trimmed: the source file also carries NAT-CORP's own daily-run
// / agent-job orchestration helpers (emit, getRun, getAgentJob, ensureAgentJob,
// patchJob, patchRun) that depend on natcorp-core.mjs and natcorp_daily_runs /
// natcorp_agent_jobs / natcorp_workflow_events tables. None of those are used
// by the intake flow (capability-profile.mjs only calls env/nowIso/json/db/
// sameOrigin) and NGCC has no equivalent orchestration system to hook them
// into, so they're left out rather than carried over unused.
export const env = (name) => globalThis.Netlify?.env?.get(name) || process.env[name] || '';
export const nowIso = () => new Date().toISOString();
export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const text = (v) => String(v ?? '').trim();
export const asArray = (v) => Array.isArray(v) ? v : [];

export function sameOrigin(req) {
  const target = new URL(req.url);
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const site = req.headers.get('sec-fetch-site');
  if (origin && origin !== target.origin) return false;
  if (referer) { try { if (new URL(referer).origin !== target.origin) return false; } catch { return false; } }
  return origin === target.origin || Boolean(referer) || site === 'same-origin';
}

function dbConfig() {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY');
  if (!base || !key) throw new Error('Supabase server configuration is missing.');
  return { base, key };
}

export async function db(table, method = 'GET', query = '', body, prefer = '') {
  const { base, key } = dbConfig();
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${base}/rest/v1/${table}${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(55000) });
  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`${table} ${method} failed (${response.status}): ${raw.slice(0, 700)}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export const rpc = (name, payload) => db(`rpc/${name}`, 'POST', '', payload, 'return=representation');
