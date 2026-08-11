import type { Config, Context } from "@netlify/edge-functions";

function rewriteHome(html: string): string {
  const refinement = `<style id="ngcc-hero-refinement">
.hero h1{color:rgba(255,255,255,.99)!important;letter-spacing:.015em!important;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;text-shadow:0 2px 10px rgba(0,0,0,.28),0 0 2px rgba(0,0,0,.10)!important}
.hero h1 em{color:rgba(255,255,255,.72)!important;text-shadow:0 1px 8px rgba(0,0,0,.22)!important}
.hero-copy{color:rgba(255,255,255,.93)!important;text-shadow:0 1px 8px rgba(0,0,0,.22)!important;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
</style>`;
  return html.includes('ngcc-hero-refinement') ? html : html.replace('</head>', refinement + '</head>');
}

function rewriteDashboard(html: string): string {
  let output = html.replace(
    "const token = 'apex-demo'; // CapGen public live demo — fixed APEX Group LLC profile (no registration)",
    "const token = new URLSearchParams(location.search).get('t') || localStorage.getItem('demo_view_token') || '';",
  );

  output = output.replaceAll(
    "oppBtn.style.display = 'inline-block';",
    "oppBtn.style.display = 'none';",
  );

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
    "function getFiltered() {\n  var pool = allOpps.filter(function(o) { return !ignoredIds.has(o.notice_id) && isEligible(o) && isCompetitive(o); });",
    "function getFiltered() {\n  if (selectedId) {\n    var selected = allOpps.find(function(o) { return (o.notice_id || o.noticeId || '') === selectedId; });\n    return selected ? [selected] : [];\n  }\n  var pool = allOpps.filter(function(o) { return !ignoredIds.has(o.notice_id) && isEligible(o) && isCompetitive(o); });",
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

function rewriteCommandCenter(html: string): string {
  if (html.includes('ngcc-left-execution-layout')) return html;
  const style = `<style id="ngcc-left-execution-layout">
@media(min-width:1051px){
  .layout{grid-template-columns:360px minmax(0,1fr)!important;align-items:start}
  .sidebar{position:sticky!important;top:58px!important;max-height:calc(100vh - 74px);overflow:auto;scrollbar-width:thin}
  .sidebar #ngccSidebarExecution{margin:12px 0 14px;padding:14px;border:1px solid rgba(213,174,85,.38);border-radius:10px;background:rgba(213,174,85,.07)}
  .sidebar #ngccSidebarExecution h2{font-size:18px;margin:.15rem 0 .4rem}
  .sidebar #ngccSidebarExecution #execDesc{font-size:12px;margin:.35rem 0 .65rem}
  .sidebar #ngccSidebarExecution #execute{width:100%}
  .sidebar #ngccSidebarExecution #stageOutput{max-height:210px;overflow:auto;margin-top:8px}
  .workspace{min-width:0}
}
</style>`;
  const script = `<script id="ngcc-left-execution-script">
(()=>{
  const mount=()=>{
    const sidebar=document.querySelector('.sidebar');
    const execute=document.getElementById('execute');
    const stages=document.getElementById('stages');
    if(!sidebar||!execute||!stages)return false;
    const executionSection=execute.closest('section.card');
    if(!executionSection||executionSection.id==='ngccSidebarExecution')return true;
    executionSection.id='ngccSidebarExecution';
    executionSection.classList.remove('card');
    sidebar.insertBefore(executionSection,stages);
    return true;
  };
  if(!mount()){
    let tries=0;
    const timer=setInterval(()=>{tries++;if(mount()||tries>80)clearInterval(timer)},100);
  }
})();
</script>`;
  return html.replace('</head>', style + '</head>').replace('</body>', script + '</body>');
}

async function rewriteHtml(context: Context, pathname: string): Promise<Response> {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (pathname === "/" || pathname === "/index.html") {
    html = rewriteHome(html);
  }
  if (pathname === "/demo" || pathname === "/demo.html") {
    html = rewriteDashboard(html);
  }
  if (pathname === "/opportunity" || pathname === "/opportunity.html") {
    html = rewriteOpportunity(html);
  }
  if (pathname === "/ops-command-center-v5.html") {
    html = rewriteCommandCenter(html);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default async (request: Request, context: Context): Promise<Response> => {
  return rewriteHtml(context, new URL(request.url).pathname);
};

export const config: Config = {
  path: ["/", "/index.html", "/demo", "/demo.html", "/opportunity", "/opportunity.html", "/ops-command-center-v5.html"],
};
