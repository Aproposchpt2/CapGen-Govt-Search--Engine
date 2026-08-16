'use strict';

const AdmZip = require('adm-zip');
const {
  sb, safe, verifyWorkspaceToken, loadOutreachById, loadSamOpportunity,
  opportunitySnapshot, publicSamUrl, fetchableSamUrl,
} = require('./lib/ngcc-federal-workspace');

const MAX_PACKAGE_BYTES = 80 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 35 * 1024 * 1024;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) };
}

function safeName(value, fallback = 'document') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 170);
  return cleaned || fallback;
}

function extensionFromType(type) {
  const t = String(type || '').split(';')[0].trim().toLowerCase();
  const map = {
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt',
    'text/html': '.html',
    'application/json': '.json',
    'image/jpeg': '.jpg',
    'image/png': '.png',
  };
  return map[t] || '';
}

function contentDispositionName(value) {
  const cd = String(value || '');
  const utf = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) { try { return decodeURIComponent(utf[1].replace(/^"|"$/g, '')); } catch {} }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
}

function nameFromUrl(url, index, contentType) {
  try {
    const parsed = new URL(url);
    const tail = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (tail && tail.length <= 160 && /\.[a-z0-9]{1,8}$/i.test(tail)) return safeName(tail);
  } catch {}
  return `SAM_Attachment_${String(index + 1).padStart(2, '0')}${extensionFromType(contentType)}`;
}

async function fetchResource(url, index) {
  const publicUrl = publicSamUrl(url);
  const response = await fetch(fetchableSamUrl(url), {
    headers: { 'user-agent': 'APROPOS-NGCC-Federal-Package/1.0', accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(55000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_SINGLE_FILE_BYTES) throw new Error('File exceeds direct-package size limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SINGLE_FILE_BYTES) throw new Error('File exceeds direct-package size limit.');
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const cdName = contentDispositionName(response.headers.get('content-disposition'));
  const fileName = safeName(cdName || nameFromUrl(publicUrl, index, contentType));
  return { bytes, fileName, contentType, publicUrl };
}

async function fetchDescription(url) {
  const publicUrl = publicSamUrl(url);
  const response = await fetch(fetchableSamUrl(url), {
    headers: { 'user-agent': 'APROPOS-NGCC-Federal-Package/1.0', accept: 'text/html,text/plain,application/json,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Description exceeds direct-package size limit.');
  const type = response.headers.get('content-type') || 'text/html';
  const ext = extensionFromType(type) || '.html';
  return { bytes, fileName: `SAM_Opportunity_Description${ext}`, contentType: type, publicUrl };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'GET only.' });

  const token = safe(event.queryStringParameters?.t);
  const verified = verifyWorkspaceToken(token);
  if (!verified) return json(401, { ok: false, error: 'This federal Opportunity Workspace session is invalid or expired.' });

  try {
    const outreach = await loadOutreachById(verified.outreach_id);
    if (!outreach) return json(404, { ok: false, error: 'The federal opportunity introduction could not be found.' });
    const provider = outreach.provider_payload && typeof outreach.provider_payload === 'object' ? outreach.provider_payload : {};
    if (!provider.claimed_at) return json(403, { ok: false, error: 'This federal opportunity has not been claimed.' });

    const sam = await loadSamOpportunity(outreach.notice_id, provider.posted_date);
    const opportunity = opportunitySnapshot(outreach, sam);
    const resourceLinks = opportunity.resource_links || [];
    if (!resourceLinks.length && !opportunity.description_url) {
      return json(409, { ok: false, error: 'SAM.gov does not currently expose a public package or description for this opportunity. Use the official SAM.gov link for authoritative access.' });
    }

    const zip = new AdmZip();
    const manifestResources = [];
    let totalBytes = 0;
    let successfulResources = 0;
    let failedResources = 0;

    if (opportunity.description_url) {
      try {
        const description = await fetchDescription(opportunity.description_url);
        totalBytes += description.bytes.length;
        if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Package exceeds direct-download size limit.');
        zip.addFile(`Contract Package/${description.fileName}`, description.bytes);
        manifestResources.push({ type: 'description', name: description.fileName, source_url: description.publicUrl, status: 'ACQUIRED', byte_size: description.bytes.length, mime_type: description.contentType });
      } catch (error) {
        manifestResources.push({ type: 'description', source_url: publicSamUrl(opportunity.description_url), status: 'NOT_ACQUIRED', error: error.message });
      }
    }

    for (let i = 0; i < resourceLinks.length; i += 1) {
      const sourceUrl = publicSamUrl(resourceLinks[i]);
      try {
        const resource = await fetchResource(resourceLinks[i], i);
        totalBytes += resource.bytes.length;
        if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Package exceeds direct-download size limit.');
        zip.addFile(`Contract Package/${resource.fileName}`, resource.bytes);
        successfulResources += 1;
        manifestResources.push({ type: 'attachment', number: i + 1, name: resource.fileName, source_url: resource.publicUrl, status: 'ACQUIRED', byte_size: resource.bytes.length, mime_type: resource.contentType });
      } catch (error) {
        failedResources += 1;
        manifestResources.push({ type: 'attachment', number: i + 1, source_url: sourceUrl, status: 'NOT_ACQUIRED', error: error.message });
      }
    }

    const status = resourceLinks.length
      ? failedResources === 0 ? 'PUBLIC_PACKAGE_ACQUIRED' : successfulResources ? 'PUBLIC_PACKAGE_PARTIAL' : 'PUBLIC_PACKAGE_NOT_ACQUIRED'
      : 'PUBLIC_NOTICE_ONLY';

    const summary = {
      prepared_by: 'APROPOS GROUP LLC / National Government Contract Center',
      package_type: 'SAM.gov public opportunity resources',
      package_status: status,
      generated_at: new Date().toISOString(),
      notice_id: opportunity.notice_id,
      solicitation_number: opportunity.solicitation_number,
      title: opportunity.title,
      agency: opportunity.agency,
      naics: opportunity.naics,
      response_deadline: opportunity.response_deadline,
      official_sam_url: opportunity.sam_url,
      resource_links_reported_by_sam: resourceLinks.length,
      attachments_acquired: successfulResources,
      attachments_not_acquired: failedResources,
      manifest: manifestResources,
      notice: 'SAM.gov and the issuing agency remain authoritative. This archive contains only resources that APROPOS could retrieve from the current public SAM.gov notice at generation time. Controlled, restricted, externally hosted, or later-revised materials may require direct access at SAM.gov or the issuing agency source.',
    };

    zip.addFile('APROPOS_Federal_Package_Manifest.json', Buffer.from(JSON.stringify(summary, null, 2), 'utf8'));
    zip.addFile('SAM_Opportunity_Summary.json', Buffer.from(JSON.stringify({
      notice_id: opportunity.notice_id,
      solicitation_number: opportunity.solicitation_number,
      title: opportunity.title,
      agency: opportunity.agency,
      naics: opportunity.naics,
      response_deadline: opportunity.response_deadline,
      posted_date: opportunity.posted_date,
      set_aside: opportunity.set_aside,
      place_of_performance: opportunity.place_of_performance,
      official_sam_url: opportunity.sam_url,
      additional_info_url: opportunity.additional_info_url,
    }, null, 2), 'utf8'));

    const bytes = zip.toBuffer();
    if (bytes.length > MAX_PACKAGE_BYTES) return json(413, { ok: false, error: 'This public SAM.gov package exceeds the direct-download limit. Use the official SAM.gov listing to retrieve the files individually.' });

    const now = new Date().toISOString();
    await sb('ngcc_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, {
      provider_payload: {
        ...provider,
        package_downloaded_at: now,
        package_retrieval_status: status,
        package_resource_count: resourceLinks.length,
        package_attachment_count: successfulResources,
        package_failed_count: failedResources,
      },
    }, 'return=minimal');

    const slug = safeName(opportunity.solicitation_number || opportunity.notice_id || 'Federal-Opportunity').replace(/\s+/g, '-');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="APROPOS_Federal_Contract_Package_${slug}.zip"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-APROPOS-Package-Status': status,
      },
      isBase64Encoded: true,
      body: bytes.toString('base64'),
    };
  } catch (error) {
    console.error('[ngcc-federal-package]', error);
    return json(500, { ok: false, error: error.message || 'The federal contract package could not be generated.' });
  }
};
