const encoder = new TextEncoder();

function cookie(request, name) {
  const value = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
}

async function validSession(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 2 && parts.length !== 3) return false;
  const [expText, roleOrSignature, versionedSignature] = parts;
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  const role = parts.length === 2 ? 'operator' : roleOrSignature;
  const signature = parts.length === 2 ? roleOrSignature : versionedSignature;
  if (!['operator', 'test_operator'].includes(role) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const message = parts.length === 2 ? `ops.${exp}` : `ops.${role}.${exp}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const supplied = new Uint8Array(signature.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)));
  return crypto.subtle.verify('HMAC', key, supplied, encoder.encode(message));
}

export default async function rfcpOperatorAuth(request, context) {
  const secret = Netlify.env.get('AUTH_TOKEN_SECRET') || '';
  const authorized = secret && await validSession(cookie(request, 'rfcp_ops'), secret).catch(() => false);
  if (authorized) return context.next();
  const returnTo = new URL(request.url).pathname;
  return Response.redirect(new URL(`/operator-login.html?returnTo=${encodeURIComponent(returnTo)}`, request.url), 302);
}

export const config = {
  path: [
    '/ops-command-center', '/ops-command-center.html', '/ops-command-center-v2.html',
    '/ops-command-center-v3.html', '/ops-command-center-v4.html', '/ops-command-center-v5.html',
    '/ops-command-center-v6.html', '/ops-command-center-v7.html', '/ops-command-center-stage01-hotfix.html',
    '/ops-dashboard', '/ops-dashboard.html',
    '/ops-outreach', '/ops-outreach.html',
  ],
};
