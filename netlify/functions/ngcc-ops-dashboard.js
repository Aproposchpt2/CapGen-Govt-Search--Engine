// NGCC ops — monitoring dashboard data. Turns the two tables the
// ops-outreach tool already writes to (ngcc_outreach_events,
// marketplace_lead_intake) into a single at-a-glance view: how many
// contracts have been worked, how many businesses emailed, how many
// claimed. Read-only, small-volume by design (this is a single-operator
// tool sending 10-20 emails per contract, not a bulk platform) -- fetches
// the full recent history and aggregates in JS rather than building
// Postgres RPCs for what's currently a modest amount of data.
'use strict';
const { json, opsGuard, sbHeaders, SUPABASE_URL } = require('./lib/ngcc-ops');

async function sb(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase ${table} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function isSince(iso, since) { return new Date(iso) >= since; }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const denied = opsGuard(event);
  if (denied) return denied;
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'GET only.' });

  try {
    const [outreach, leads] = await Promise.all([
      sb('ngcc_outreach_events', '?select=outreach_id,notice_id,contract_title,contract_naics,business_name,contact_email,status,sent_at,created_at&order=created_at.desc&limit=500'),
      sb('marketplace_lead_intake', '?select=id,business_name,contact_email,source,source_reference,status,created_at&order=created_at.desc&limit=500'),
    ]);

    const today = daysAgo(0); today.setHours(0, 0, 0, 0);
    const weekAgo = daysAgo(7);

    const sentOutreach = outreach.filter(o => o.status === 'sent');
    const failedOutreach = outreach.filter(o => o.status === 'failed');
    const claims = leads.filter(l => l.source === 'ngcc_outreach_claim');
    const freeOffers = leads.filter(l => l.source === 'marketplace_cta');

    // Per-contract breakdown: how many were emailed vs how many of those
    // notice_ids show up as a claimed lead (source_reference match).
    const claimedNoticeIds = new Set(claims.map(c => c.source_reference).filter(Boolean));
    const byContract = new Map();
    for (const o of outreach) {
      if (!o.notice_id) continue;
      if (!byContract.has(o.notice_id)) byContract.set(o.notice_id, { notice_id: o.notice_id, contract_title: o.contract_title, contract_naics: o.contract_naics, sent: 0, failed: 0, draft: 0 });
      const row = byContract.get(o.notice_id);
      if (o.status === 'sent') row.sent++;
      else if (o.status === 'failed') row.failed++;
      else row.draft++;
    }
    const per_contract = [...byContract.values()]
      .map(c => ({ ...c, claimed: claimedNoticeIds.has(c.notice_id) }))
      .sort((a, b) => b.sent - a.sent);

    const recent = [
      ...outreach.slice(0, 15).map(o => ({ type: 'outreach', at: o.created_at, business_name: o.business_name, detail: o.contract_title, status: o.status })),
      ...leads.slice(0, 15).map(l => ({ type: l.source === 'ngcc_outreach_claim' ? 'claim' : 'free_offer', at: l.created_at, business_name: l.business_name, detail: l.source_reference || null, status: l.status })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 20);

    return json(200, {
      ok: true,
      summary: {
        outreach_sent_total: sentOutreach.length,
        outreach_sent_week: sentOutreach.filter(o => isSince(o.sent_at || o.created_at, weekAgo)).length,
        outreach_sent_today: sentOutreach.filter(o => isSince(o.sent_at || o.created_at, today)).length,
        outreach_failed_total: failedOutreach.length,
        claims_total: claims.length,
        claims_week: claims.filter(l => isSince(l.created_at, weekAgo)).length,
        free_offers_total: freeOffers.length,
        free_offers_week: freeOffers.filter(l => isSince(l.created_at, weekAgo)).length,
        claim_rate_pct: sentOutreach.length ? Math.round((claims.length / sentOutreach.length) * 1000) / 10 : null,
        contracts_worked: byContract.size,
      },
      per_contract,
      recent,
    });
  } catch (error) {
    console.error('[ngcc-ops-dashboard]', error.message);
    return json(500, { ok: false, error: error.message });
  }
};
