import { createRequire } from 'node:module';
import { json, sameOrigin } from './_shared/ngcc-profile-db.mjs';
import { loadProfileSession } from './_shared/ngcc-profile-session.mjs';
import { searchSamOpportunities } from './lib/ngcc-sam-opportunities.js';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const MAX_PACKAGE_BYTES = 80 * 1024 * 1024;
const MAX_FILE_BYTES = 35 * 1024 * 1024;

function safe(value) { return String(value ?? '').trim(); }
function safeName(value, fallback = 'document') {
  return String(value || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 160) || fallback;
}
function ext(type) {
  const t = String(type || '').split(';')[0].toLowerCase();
  return ({'application/pdf':'.pdf','application/zip':'.zip','application/msword':'.doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.ms-excel':'.xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx','text/plain':'.txt','text/html':'.html','application/json':'.json','image/jpeg':'.jpg','image/png':'.png'})[t] || '';
}
async function acquire(url, fallbackName) {
  const response = await fetch(url, { headers: { 'user-agent': 'APROPOS-Federal-Contract-Workspace/1.0', accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(55000) });
  if (!response.ok) throw new Error(`Upstream resource returned HTTP ${response.status}.`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_FILE_BYTES) throw new Error('Resource exceeds package size limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Resource exceeds package size limit.');
  const type = response.headers.get('content-type') || 'application/octet-stream';
  return { bytes, type, name: safeName(`${fallbackName}${ext(type)}`) };
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'GET') return json(405, { ok: false, error: 'GET only.' });

  try {
    const session = await loadProfileSession(req);
    if (!session) return json(401, { ok: false, error: 'Business profile session is missing or expired.' });
    if (session.discovery_status !== 'verified') return json(409, { ok: false, error: 'Verify your business profile before downloading contract documents.' });

    const requestUrl = new URL(req.url);
    const noticeId = safe(requestUrl.searchParams.get('id'));
    if (!noticeId) return json(400, { ok: false, error: 'Contract notice ID is required.' });

    const result = await searchSamOpportunities({ noticeId, activeOnly: false, limit: 5, defaultDays: 365 });
    const row = result.rows.find(item => safe(item.noticeId) === noticeId) || result.rows[0];
    if (!row) return json(404, { ok: false, error: 'This federal contract is no longer available from the upstream public record.' });

    const sources = [];
    if (row.description) sources.push({ url: row.description, label: 'Contract_Description' });
    for (const [index, url] of (Array.isArray(row.resourceLinks) ? row.resourceLinks : []).entries()) {
      sources.push({ url, label: `Contract_Attachment_${String(index + 1).padStart(2, '0')}` });
    }
    if (!sources.length) return json(409, { ok: false, error: 'No downloadable public contract documents are currently available for this opportunity.' });

    const zip = new AdmZip();
    const manifest = [];
    let total = 0;
    for (const source of sources) {
      try {
        const file = await acquire(source.url, source.label);
        total += file.bytes.length;
        if (total > MAX_PACKAGE_BYTES) throw new Error('Contract package exceeds direct-download size limit.');
        zip.addFile(`Contract Package/${file.name}`, file.bytes);
        manifest.push({ name: file.name, status: 'ACQUIRED', byte_size: file.bytes.length, mime_type: file.type });
      } catch (error) {
        manifest.push({ name: source.label, status: 'NOT_ACQUIRED', error: error.message });
      }
    }

    if (!manifest.some(item => item.status === 'ACQUIRED')) return json(409, { ok: false, error: 'The contract documents could not be packaged at this time. Please try again later.' });

    zip.addFile('APROPOS_Contract_Package_Manifest.json', Buffer.from(JSON.stringify({
      prepared_by: 'Apropos Group LLC',
      package_type: 'Federal contract opportunity package',
      generated_at: new Date().toISOString(),
      notice_id: row.noticeId || noticeId,
      solicitation_number: row.solicitationNumber || null,
      title: row.title || null,
      agency: row.fullParentPathName || row.department || row.subTier || null,
      documents: manifest,
      provenance: 'Official federal public record; source provenance retained internally by Apropos Group LLC.',
    }, null, 2), 'utf8'));

    const bytes = zip.toBuffer();
    if (bytes.length > MAX_PACKAGE_BYTES) return json(413, { ok: false, error: 'This contract package exceeds the direct-download size limit.' });
    const slug = safeName(row.solicitationNumber || row.noticeId || 'Federal-Contract').replace(/\s+/g, '-');
    return { statusCode: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="APROPOS_Federal_Contract_Package_${slug}.zip"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, isBase64Encoded: true, body: bytes.toString('base64') };
  } catch (error) {
    console.error('[ngcc-federal-contract-package]', error);
    return json(500, { ok: false, error: 'The federal contract package could not be generated.' });
  }
}

export const config = {
  path: '/api/federal-contract-package',
  rateLimit: { windowLimit: 8, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
