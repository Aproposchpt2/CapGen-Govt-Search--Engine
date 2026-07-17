import type { Config, Context } from "@netlify/edge-functions";

function rewriteDemo(html: string): string {
  let output = html.replace(
    "const token = 'apex-demo'; // CapGen public live demo — fixed APEX Group LLC profile (no registration)",
    "const token = new URLSearchParams(location.search).get('t') || localStorage.getItem('demo_view_token') || '';",
  );

  // The search dashboard is already ordered and filtered. Remove the redundant
  // global Best Match CTA and place its destination on each contract title.
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

  // Return to the filter-rich search dashboard rather than the older snapshot route.
  output = output.replace(
    "document.getElementById('backBtn').href = token ? '/demo/snapshot?t=' + encodeURIComponent(token) : '/demo';",
    "document.getElementById('backBtn').href = token ? '/demo?t=' + encodeURIComponent(token) : '/demo';",
  );

  // Add an explicit return action to the selected contract detail card.
  output = output.replace(
    "+ '<div class=\"card-actions\">'",
    "+ '<div class=\"card-actions\">'\n    + (selectedId ? '<a href=\"/demo?t=' + encodeURIComponent(token) + '\" class=\"btn-view\">← Return to Search Dashboard</a>' : '')",
  );

  // When a contract was selected on the dashboard, preserve the existing card
  // design but show only that contract as the dedicated detail view.
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
    "const sessionTok  = sessionData ? sessionData.session_token : '';",
    "let sessionTok  = sessionData ? sessionData.session_token : (sessionStorage.getItem('capgen_demo_session') || '');",
  );

  // Return from the report to the same selected contract detail page.
  output = output.replace(
    "document.getElementById('backBtn').href = token ? '/opportunity?t=' + encodeURIComponent(token) : '/opportunity';",
    "document.getElementById('backBtn').href = token ? '/opportunity?t=' + encodeURIComponent(token) + '&id=' + encodeURIComponent(noticeId) : '/opportunity';",
  );

  // A personalized demo token is a valid recovery-test entry path.
  output = output.replace(
    "} else if (!isDemo) {\n  window.location.href = '/onboarding';\n}",
    "} else if (!token) {\n  window.location.href = '/onboarding';\n}",
  );

  // Fix the temporal-dead-zone error discovered during the public demo report.
  output = output.replace(
    "function startProgress() {\n  progressBar.classList.remove('done');\n  progressBar.classList.add('running');\n}",
    "function startProgress() {\n  const bar = document.getElementById('progress-bar');\n  if (!bar) return;\n  bar.classList.remove('done');\n  bar.classList.add('running');\n}",
  );

  output = output.replace(
    "function completeProgress() {\n  progressBar.classList.remove('running');\n  progressBar.classList.add('done');\n}",
    "function completeProgress() {\n  const bar = document.getElementById('progress-bar');\n  if (!bar) return;\n  bar.classList.remove('running');\n  bar.classList.add('done');\n}",
  );

  // Exchange the personalized dashboard token for the short-lived server-side
  // session required by the existing Analyze Fit backend.
  output = output.replace(
    "async function runAnalysis(force = false) {\n  if (!noticeId || (!sessionTok && !betaToken)) return;",
    "async function runAnalysis(force = false) {\n  if (!sessionTok && !betaToken && token && !isDemo) {\n    try {\n      const sessionRes = await fetch('/.netlify/functions/demo-session', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ view_token: token }),\n      });\n      const sessionJson = await sessionRes.json();\n      if (!sessionRes.ok || !sessionJson.session_token) throw new Error(sessionJson.error || 'Could not open Analyze Fit session.');\n      sessionTok = sessionJson.session_token;\n      sessionStorage.setItem('capgen_demo_session', sessionTok);\n    } catch (sessionError) {\n      document.getElementById('loadingEl').innerHTML = '<p style=\"color:var(--red);text-align:center;padding:40px\">' + esc(sessionError.message || 'Could not open Analyze Fit session.') + '</p>';\n      return;\n    }\n  }\n  if (!noticeId || (!sessionTok && !betaToken)) return;",
  );

  // Preserve the public sample report while allowing personalized dashboards to
  // execute the real Stage 1 and Stage 2 analysis pipeline.
  output = output.replace(
    "// Start\nrunAnalysis(false);",
    "// Start\nif (!isDemo) runAnalysis(false);",
  );

  return output;
}

async function rewriteHtml(context: Context, pathname: string): Promise<Response> {
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
  return rewriteHtml(context, new URL(req.url).pathname);
};

export const config: Config = {
  path: [
    "/demo",
    "/demo.html",
    "/opportunity",
    "/opportunity.html",
    "/analyze-fit",
    "/analyze-fit.html",
  ],
};
