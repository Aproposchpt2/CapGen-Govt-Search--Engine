import type { Config, Context } from "@netlify/edge-functions";

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function supabaseHeaders(serviceKey: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function authorizeDemoAnalysis(req: Request, context: Context): Promise<Response> {
  const bodyText = await req.text();
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(bodyText || "{}");
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const demoToken = typeof body.demo_token === "string" ? body.demo_token.trim() : "";
  if (!demoToken || demoToken === "apex-demo") {
    const passHeaders = new Headers(req.headers);
    return context.nextRequest(new Request(req.url, {
      method: req.method,
      headers: passHeaders,
      body: bodyText,
    }));
  }

  const supabaseUrl = Netlify.env.get("SUPABASE_URL") || "";
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Analyze Fit preview authentication is not configured." }, 500);
  }

  const snapshotRes = await fetch(
    `${supabaseUrl}/rest/v1/demo_snapshots?view_token=eq.${encodeURIComponent(demoToken)}&select=requester_email,business_name,entity_uei&limit=1`,
    { headers: supabaseHeaders(serviceKey) },
  );

  if (!snapshotRes.ok) {
    return jsonResponse({ error: "Could not validate the dashboard profile." }, 502);
  }

  const snapshots = await snapshotRes.json();
  const snapshot = Array.isArray(snapshots) ? snapshots[0] : null;
  const email = String(snapshot?.requester_email || "").trim().toLowerCase();

  if (!email) {
    return jsonResponse({ error: "Dashboard profile not found." }, 401);
  }

  const nowIso = new Date().toISOString();
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/client_sessions?email=eq.${encodeURIComponent(email)}&revoked=eq.false&expires_at=gt.${encodeURIComponent(nowIso)}&select=session_token,expires_at&order=created_at.desc&limit=1`,
    { headers: supabaseHeaders(serviceKey) },
  );

  let sessionToken = "";
  if (existingRes.ok) {
    const existing = await existingRes.json();
    sessionToken = String(Array.isArray(existing) && existing[0]?.session_token || "");
  }

  if (!sessionToken) {
    sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const createRes = await fetch(`${supabaseUrl}/rest/v1/client_sessions`, {
      method: "POST",
      headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
      body: JSON.stringify({
        session_token: sessionToken,
        email,
        uei: String(snapshot?.entity_uei || ""),
        business_name: String(snapshot?.business_name || ""),
        account_type: "demo",
        expires_at: expiresAt,
      }),
    });

    if (!createRes.ok) {
      return jsonResponse({ error: "Could not create the Analyze Fit preview session." }, 502);
    }
  }

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("authorization", `Bearer ${sessionToken}`);

  return context.nextRequest(new Request(req.url, {
    method: req.method,
    headers: forwardedHeaders,
    body: bodyText,
  }));
}

function rewriteDemo(html: string): string {
  let output = html.replace(
    "const token = 'apex-demo'; // CapGen public live demo — fixed APEX Group LLC profile (no registration)",
    "const token = new URLSearchParams(location.search).get('t') || localStorage.getItem('demo_view_token') || '';",
  );

  output = output.replaceAll("oppBtn.style.display = 'inline-block';", "oppBtn.style.display = 'none';");

  output = output.replace(
    "'<td class=\"title-cell\"><a href=\"' + esc(o.url) + '\" target=\"_blank\" rel=\"noopener\">'",
    "'<td class=\"title-cell\"><a href=\"/opportunity?t=' + encodeURIComponent(token) + '&id=' + encodeURIComponent(o.notice_id || '') + '\">'",
  );

  return output;
}

function rewriteOpportunity(html: string): string {
  let output = html.replace(
    "const token = q.get('t') || localStorage.getItem('demo_view_token') || '';",
    "const token = q.get('t') || localStorage.getItem('demo_view_token') || '';\nconst selectedId = q.get('id') || '';",
  );

  output = output.replace(
    "document.getElementById('backBtn').href = token ? '/demo/snapshot?t=' + encodeURIComponent(token) : '/demo';",
    "document.getElementById('backBtn').href = token ? '/demo?t=' + encodeURIComponent(token) : '/demo';",
  );

  output = output.replace(
    "+ '<div class=\"card-actions\">'",
    "+ '<div class=\"card-actions\">'\n    + (selectedId ? '<a href=\"/demo?t=' + encodeURIComponent(token) + '\" class=\"btn-view\">← Return to Search Dashboard</a>' : '')",
  );

  output = output.replace(
    "function getFiltered() {\n  var pool = allOpps.filter(function(o) { return !ignoredIds.has(o.notice_id) && isEligible(o) && isCompetitive(o); });",
    "function getFiltered() {\n  if (selectedId) {\n    var selected = allOpps.find(function(o) { return o.notice_id === selectedId; });\n    return selected ? [selected] : [];\n  }\n  var pool = allOpps.filter(function(o) { return !ignoredIds.has(o.notice_id) && isEligible(o) && isCompetitive(o); });",
  );

  output = output.replace(
    "function renderPage() {\n  var filtered = getFiltered();",
    "function renderPage() {\n  if (selectedId) document.getElementById('controlsEl').style.display = 'none';\n  var filtered = getFiltered();",
  );

  output = output.replace(
    "if (bizName) document.getElementById('bannerBiz').textContent = bizName + ' — Best Matches';",
    "if (bizName) document.getElementById('bannerBiz').textContent = bizName + (selectedId ? ' — Contract Details' : ' — Best Matches');",
  );

  return output;
}

function rewriteAnalyzeFit(html: string): string {
  let output = html.replace(
    "document.getElementById('backBtn').href = token ? '/opportunity?t=' + encodeURIComponent(token) : '/opportunity';",
    "document.getElementById('backBtn').href = token ? '/opportunity?t=' + encodeURIComponent(token) + '&id=' + encodeURIComponent(noticeId) : '/opportunity';",
  );

  output = output.replace(
    "} else if (!isDemo) {\n  window.location.href = '/onboarding';\n}",
    "} else if (!token) {\n  window.location.href = '/onboarding';\n}",
  );

  output = output.replace(
    "function startProgress() {\n  progressBar.classList.remove('done');\n  progressBar.classList.add('running');\n}",
    "function startProgress() {\n  const bar = document.getElementById('progress-bar');\n  if (!bar) return;\n  bar.classList.remove('done');\n  bar.classList.add('running');\n}",
  );

  output = output.replace(
    "function completeProgress() {\n  progressBar.classList.remove('running');\n  progressBar.classList.add('done');\n}",
    "function completeProgress() {\n  const bar = document.getElementById('progress-bar');\n  if (!bar) return;\n  bar.classList.remove('running');\n  bar.classList.add('done');\n}",
  );

  output = output.replace(
    "if (!noticeId || (!sessionTok && !betaToken)) return;",
    "if (!noticeId || (!sessionTok && !betaToken && !token)) return;",
  );

  output = output.replaceAll(
    "beta_token: betaToken,",
    "beta_token: betaToken,\n    demo_token: (!betaToken && !sessionTok) ? token : undefined,",
  );

  output = output.replace(
    "// Start\nrunAnalysis(false);",
    "// Start\nif (!isDemo) runAnalysis(false);",
  );

  return output;
}

async function rewriteHtml(req: Request, context: Context, pathname: string): Promise<Response> {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (pathname === "/demo" || pathname === "/demo.html") html = rewriteDemo(html);
  if (pathname === "/opportunity" || pathname === "/opportunity.html") html = rewriteOpportunity(html);
  if (pathname === "/analyze-fit" || pathname === "/analyze-fit.html") html = rewriteAnalyzeFit(html);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default async (req: Request, context: Context): Promise<Response> => {
  const url = new URL(req.url);

  if (url.pathname === "/.netlify/functions/analyze-fit" && req.method === "POST") {
    return authorizeDemoAnalysis(req, context);
  }

  return rewriteHtml(req, context, url.pathname);
};

export const config: Config = {
  path: [
    "/demo",
    "/demo.html",
    "/opportunity",
    "/opportunity.html",
    "/analyze-fit",
    "/analyze-fit.html",
    "/.netlify/functions/analyze-fit",
  ],
};
