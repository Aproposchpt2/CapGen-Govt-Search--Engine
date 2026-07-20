import { randomUUID } from 'node:crypto';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function supabaseHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const viewToken = String(body?.view_token || '').trim();
  if (!viewToken || viewToken === 'apex-demo' || viewToken.length > 200) {
    return json(400, { error: 'Valid dashboard token required.' });
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') || Netlify.env.get('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'Demo session service is not configured.' });
  }

  const lookupUrl = `${supabaseUrl}/rest/v1/demo_snapshots?view_token=eq.${encodeURIComponent(viewToken)}&select=requester_email,business_name,entity_uei,profile&limit=1`;
  const lookup = await fetch(lookupUrl, {
    headers: supabaseHeaders(serviceKey),
  });

  if (!lookup.ok) {
    console.error('[demo-session] snapshot lookup failed:', (await lookup.text()).slice(0, 300));
    return json(502, { error: 'Could not validate dashboard token.' });
  }

  const rows = await lookup.json();
  const snapshot = Array.isArray(rows) ? rows[0] : null;
  if (!snapshot?.requester_email) {
    return json(404, { error: 'Dashboard profile not found.' });
  }

  const email = String(snapshot.requester_email).trim().toLowerCase();
  const businessName = snapshot.business_name || snapshot.profile?.legal_name || '';
  const uei = snapshot.entity_uei || snapshot.profile?.uei || '';
  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const insert = await fetch(`${supabaseUrl}/rest/v1/client_sessions`, {
    method: 'POST',
    headers: supabaseHeaders(serviceKey, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      session_token: sessionToken,
      email,
      uei,
      business_name: businessName,
      account_type: 'demo',
      expires_at: expiresAt,
    }),
  });

  if (!insert.ok) {
    console.error('[demo-session] session insert failed:', (await insert.text()).slice(0, 300));
    return json(502, { error: 'Could not open Analyze Fit session.' });
  }

  return json(200, {
    ok: true,
    session_token: sessionToken,
    email,
    uei,
    business_name: businessName,
    account_type: 'demo',
    expires_at: expiresAt,
  });
};
