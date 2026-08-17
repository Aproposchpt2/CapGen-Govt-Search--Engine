// ngcc-state-contract-documents.mjs -- 2026-08-17. Serves the real, already-
// acquired solicitation package for a state contract (contract_package_documents
// + Supabase Storage) so the State Contract Workspace can show the actual
// package instead of ever redirecting a visitor out to the issuing agency's
// own site. Ported from NAT-CORP's contract-package-documents.mjs (same
// shared Supabase project, same table -- CA/NV/AZ packages already land
// there via APIE's own acquisition engine and the NGEM connector built
// earlier this session). Documents are served via short-lived signed
// Storage URLs (never the service-role key itself), so this stays safe to
// call from the browser.
import { db, env, json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';

const safe = (v, n = 200) => String(v ?? '').trim().slice(0, n);

const DOCUMENT_TYPE_LABEL = {
  RFP: 'Request for Proposal',
  RFQ: 'Request for Quote',
  RFSQ: 'Request for Statement of Qualifications',
  IFB: 'Invitation for Bid',
  EVALUATION: 'Evaluation Criteria',
  Q_AND_A: 'Questions & Answers',
  AMENDMENT: 'Amendment',
  ADDENDUM: 'Addendum',
  ATTACHMENT: 'Attachment',
  SCOPE_OF_WORK: 'Scope of Work',
  SPECIFICATIONS: 'Specifications',
  INSTRUCTIONS: 'Instructions',
  PRICING: 'Pricing',
  INSURANCE_BONDING: 'Insurance / Bonding',
  FORMS: 'Forms',
  DRAWINGS: 'Drawings',
  EXHIBIT: 'Exhibit',
  OTHER: 'Supporting Document',
};

// download: falsy = inline view (opens in the browser's own viewer, which
// has its own print control); a filename string = forces
// Content-Disposition: attachment via a query param on the signed URL
// itself (not a /sign POST body field -- Supabase silently ignores that).
async function signedUrl(bucket, path, { expiresIn = 600, download = null } = {}) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY');
  const encodedPath = String(path || '').split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.signedURL) throw new Error(data.message || `Could not sign document URL (${res.status}).`);
  const fullUrl = `${base}/storage/v1${data.signedURL}`;
  if (!download) return fullUrl;
  const filenamePart = typeof download === 'string' && download.trim() ? `=${encodeURIComponent(download.trim())}` : '';
  return `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}download${filenamePart}`;
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });
  try {
    const session = await loadProfileSession(req);
    if (!session || session.discovery_status !== 'verified') {
      return json(401, { ok: false, error: 'A verified business profile is required.' });
    }
    const body = await req.json().catch(() => ({}));
    const opportunityId = safe(body.opportunity_id, 80);
    if (!opportunityId) return json(400, { ok: false, error: 'opportunity_id is required.' });

    const rows = await db(
      'contract_package_documents', 'GET',
      `?canonical_opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=id,original_filename,document_type,byte_size,storage_bucket,storage_path,extraction_status&order=document_type.asc`,
    );

    const documents = await Promise.all((rows || []).map(async (d) => {
      let url = null;
      let downloadUrl = null;
      let error = null;
      try {
        [url, downloadUrl] = await Promise.all([
          signedUrl(d.storage_bucket, d.storage_path),
          signedUrl(d.storage_bucket, d.storage_path, { download: d.original_filename || true }),
        ]);
      } catch (e) { error = e.message; }
      return {
        id: d.id,
        filename: d.original_filename,
        document_type: d.document_type,
        document_type_label: DOCUMENT_TYPE_LABEL[d.document_type] || d.document_type || 'Document',
        byte_size: d.byte_size,
        extraction_status: d.extraction_status,
        url,
        download_url: downloadUrl,
        error,
      };
    }));

    return json(200, { ok: true, opportunity_id: opportunityId, count: documents.length, documents });
  } catch (error) {
    console.error('[ngcc-state-contract-documents]', error);
    return json(500, { ok: false, error: safe(error?.message, 500) || 'The solicitation package could not be loaded.' });
  }
}

export const config = {
  path: '/api/state-contract-documents',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
