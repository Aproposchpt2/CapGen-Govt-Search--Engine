const OLD_HERO_BLOCK = `    <div class="hero-left">
     <div class="hero-badge">
      <span class="badge-dot"></span>
      Managed Contract Intelligence &nbsp;·&nbsp; Federal Marketplace
     </div>

     <div class="hero-eyebrow">
      <div class="eyebrow-line"></div>
      <span class="eyebrow-text">Apropos Group LLC &nbsp;·&nbsp; CapGen</span>
     </div>

     <h1 class="hero-h1">
      Every contract
      <em>built for your business.</em>
     </h1>

     <div class="hero-system">
      Contract Intelligence &nbsp;|&nbsp; NAICS Filtering &nbsp;|&nbsp; Live Opportunity Dashboard
     </div>

     <p class="hero-copy">
      CapGen is a <strong>fully managed government contract intelligence service.</strong>
      We tune our search engine to your exact NAICS codes, filter the federal marketplace
      in real time, and deliver a personalized opportunity dashboard — so you only ever
      see the contracts your business can actually win.
     </p>

     <div class="hero-pills">
      <span class="pill"><span class="pill-dot"></span>NAICS-Matched Opportunities</span>
      <span class="pill"><span class="pill-dot"></span>Live Federal Marketplace</span>
      <span class="pill"><span class="pill-dot"></span>Done-For-You Service</span>
      <span class="pill"><span class="pill-dot"></span>Custom Dashboard</span>
     </div>`;

const NEW_HERO_BLOCK = `    <div class="hero-left">
     <div class="hero-badge">
      <span class="badge-dot"></span>
      APROPOS GROUP LLC
     </div>

     <div class="hero-eyebrow">
      <div class="eyebrow-line"></div>
      <span class="eyebrow-text">CapGen Intelligent Pro Scanner</span>
     </div>

     <h1 class="hero-h1">
      Find Government Contracts
      <em>That Match Your Business.</em>
     </h1>

     <div class="hero-system">
      Official Public Records &nbsp;|&nbsp; Capability Profile Matching &nbsp;|&nbsp; Best-Fit Analysis
     </div>

     <p class="hero-copy">
      Our CapGen Intelligent Pro Scanner searches official government public records and builds a personalized opportunity dashboard around your Capability Profile.
     </p>

     <p class="hero-copy">
      Review open contracts that match your services, NAICS codes, certifications, location preferences, and closing deadlines — all in one place.
     </p>

     <p class="hero-copy">
      CapGen helps identify your best-fit opportunities and provides an analysis report for each match, so you can focus on the contracts most aligned with your business.
     </p>

     <div class="hero-pills">
      <span class="pill"><span class="pill-dot"></span>Official Public Records</span>
      <span class="pill"><span class="pill-dot"></span>Capability Profile Match</span>
      <span class="pill"><span class="pill-dot"></span>Best-Fit Analysis Reports</span>
      <span class="pill"><span class="pill-dot"></span>State · NAICS · Days To Close</span>
     </div>`;

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    return response;
  }

  const html = await response.text();
  const updatedHtml = html.includes(OLD_HERO_BLOCK)
    ? html.replace(OLD_HERO_BLOCK, NEW_HERO_BLOCK)
    : html;

  return new Response(updatedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const config = {
  path: '/',
};
