export default async function (_request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  const corrected = html
    .replace(/https:\/\/nvgovcc\.aproposgroupllc\.com\/welcome\.html/g, 'https://natcorp.aproposgroupllc.com/welcome.html')
    .replace(/https:\/\/calgovcc\.aproposgroupllc\.com\/welcome\.html/g, 'https://natcorp.aproposgroupllc.com/welcome.html');

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');

  return new Response(corrected, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
