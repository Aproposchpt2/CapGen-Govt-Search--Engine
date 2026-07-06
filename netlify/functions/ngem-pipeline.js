// NGCC — Nevada NGEM Pipeline
// Pulls live open solicitations from Nevada Government eMarketplace (Ionwave).
// Identical data source to STATEGEN — shared and normalized for NGCC.

const LIST_URL = 'https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods':'GET, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Cache-Control':               'public, max-age=300',
};

const SAMPLE_BIDS = [
  { id:'nv-001', solicitation_no:'NV-PUR-26-0204', title:'Temporary Staffing — Administrative Support', type:'RFP', agency:'State of Nevada — Purchasing Division', close_date:'2026-07-28', url:'https://nevada.ionwave.net' },
  { id:'nv-002', solicitation_no:'CC-IT-2026-044',  title:'Enterprise Network Infrastructure Upgrade',   type:'BID', agency:'Clark County, Nevada',                 close_date:'2026-07-31', url:'https://nevada.ionwave.net' },
  { id:'nv-003', solicitation_no:'COLV-PR-26-007', title:'Citywide Park Landscape Maintenance',          type:'BID', agency:'City of Las Vegas, Nevada',             close_date:'2026-07-26', url:'https://nevada.ionwave.net' },
  { id:'nv-004', solicitation_no:'NV-DOT-26-0118', title:'Highway Signage Replacement — I-15 Corridor', type:'BID', agency:'Nevada Department of Transportation',    close_date:'2026-08-05', url:'https://nevada.ionwave.net' },
  { id:'nv-005', solicitation_no:'WN-IT-2026-031', title:'Managed IT Services — Help Desk Support',     type:'RFP', agency:'Washoe County, Nevada',                  close_date:'2026-08-12', url:'https://nevada.ionwave.net' },
];

const cache = { at: 0, bids: null };
const TTL   = 5 * 60 * 1000;

function cleanCell(html) {
  return html.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
    .replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
}

function toIso(closeStr) {
  const m = String(closeStr||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m) return null;
  return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
}

function daysUntil(isoDate) {
  if(!isoDate) return null;
  return Math.ceil((new Date(isoDate) - new Date()) / 864e5);
}

function parseBids(html) {
  const bidIdByRow = {};
  for(const k of html.matchAll(/"(\d+)":\{"BidID":"(\d+)"\}/g)) bidIdByRow[k[1]] = k[2];

  const gi  = html.indexOf('rgBidList_ctl00"');
  const seg = gi > 0 ? html.slice(gi) : html;
  const rowRe = /id="ctl00_mainContent_rgBidList_ctl00__(\d+)"([\s\S]*?)(?=id="ctl00_mainContent_rgBidList_ctl00__\d+"|<\/table)/g;
  const bids  = [];
  let m;
  while((m = rowRe.exec(seg)) !== null) {
    const idx  = m[1];
    const body = m[2];
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => cleanCell(c[1]));
    if(cells.length < 4) continue;
    const bidId = bidIdByRow[idx] || idx;
    const closeIso = toIso(cells[3] || cells[4] || '');
    const days = daysUntil(closeIso);
    if(days !== null && days < 0) continue;
    bids.push({
      id:              'nv-' + bidId,
      solicitation_no: cells[0] || ('NV-' + bidId),
      title:           cells[1] || 'Nevada Solicitation',
      type:            (cells[2] || 'BID').toUpperCase(),
      agency:          cells[4] || cells[5] || 'Nevada Agency',
      close_date:      closeIso,
      due_in_days:     days,
      url:             `https://nevada.ionwave.net/PublicDetail.aspx?bidID=${bidId}&SourceType=1`,
    });
  }
  return bids;
}

async function liveBids() {
  const res = await fetch(LIST_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(12000),
  });
  if(!res.ok) throw new Error('NGEM HTTP ' + res.status);
  const html = await res.text();
  const bids = parseBids(html);
  if(!bids.length) throw new Error('NGEM parse: 0 bids extracted');
  return bids;
}

export default async (req) => {
  if(req.method === 'OPTIONS') return new Response('', { headers: CORS });

  if(cache.bids && Date.now() - cache.at < TTL) {
    return new Response(JSON.stringify({ ok:true, source:'cache', bids:cache.bids, total:cache.bids.length }), { headers: CORS });
  }

  try {
    const bids = await liveBids();
    cache.bids = bids;
    cache.at   = Date.now();
    return new Response(JSON.stringify({ ok:true, source:'live', bids, total:bids.length, generatedAt: new Date().toISOString() }), { headers: CORS });
  } catch(err) {
    console.error('[ngem-pipeline]', err.message);
    const fallback = SAMPLE_BIDS;
    return new Response(JSON.stringify({ ok:true, source:'fallback', bids:fallback, total:fallback.length, fallbackReason:err.message }), { headers: CORS });
  }
};
