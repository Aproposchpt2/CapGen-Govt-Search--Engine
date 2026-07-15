export default async (request, context) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();

  const oldNavLogin = '<a class="cgbtn outline" href="/onboarding">Member Login</a>';
  const oldBcModalButton = '<button class="cgbtn" onclick="document.getElementById(\'bcModal\').style.display=\'flex\'" style="background:#C9A84C;color:#0F2A6A;font-weight:800;font-size:.68rem;letter-spacing:.13em;text-transform:uppercase;padding:.62rem 1.3rem;border:none;border-radius:999px;cursor:pointer;white-space:nowrap">BC Members Login</button>';
  const injectedMembersLogin = '<a class="cgbtn" href="https://capgen.aproposgroupllc.com/login" style="background:#C9A84C;color:#0F2A6A;font-weight:800;font-size:.68rem;letter-spacing:.13em;text-transform:uppercase;padding:.62rem 1.3rem;border:none;border-radius:999px;cursor:pointer;white-space:nowrap">MEMBERS LOGIN</a>';

  // Homepage navigation no longer includes a member-login CTA.
  html = html.replace(oldNavLogin, '');
  html = html.replace(oldBcModalButton, '');
  html = html.replace(injectedMembersLogin, '');

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
