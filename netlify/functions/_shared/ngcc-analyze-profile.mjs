// RFC-PORTAL-VATP-001 — canonical Analyze Fit profile adapter.
// Prefer the verified merged NGCC/Nat-Corp business profile. Legacy callers may
// fall back to demo_snapshots in their own functions for backward compatibility.

const asArray = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();

function joinCapabilities(verified) {
  const values = [
    ...asArray(verified.capabilities),
    ...asArray(verified.services),
    ...asArray(verified.products),
    ...asArray(verified.core_competencies),
  ].map((value) => text(typeof value === 'object' ? value?.name : value)).filter(Boolean);
  return [...new Set(values)].join('; ') || 'Not specified';
}

export async function loadMergedAnalyzeProfile(sbGet, email) {
  const normalized = text(email).toLowerCase();
  if (!normalized || typeof sbGet !== 'function') return null;
  const rows = await sbGet(
    `natcorp_business_intakes?intake_kind=eq.business_profile&business_email=eq.${encodeURIComponent(normalized)}&discovery_status=eq.verified&select=business_name,business_email,verified_profile,business_profile_id,updated_at&order=updated_at.desc&limit=1`,
  );
  const intake = rows?.[0];
  if (!intake) return null;
  const verified = intake.verified_profile || {};
  const naics = [...new Set(asArray(verified.naics_codes).map(text).filter(Boolean))];
  return {
    profile_source: 'merged_verified_profile',
    business_profile_id: intake.business_profile_id || null,
    business_name: text(verified.business_name || verified.legal_name || intake.business_name),
    legal_name: text(verified.legal_name || verified.business_name || intake.business_name),
    uei: text(verified.uei),
    cage: text(verified.cage),
    naics,
    set_asides: asArray(verified.set_asides),
    certifications: asArray(verified.certifications),
    capabilities: joinCapabilities(verified),
    past_performance: text(verified.past_performance) || 'Not specified',
    team_size: text(verified.team_size) || 'Not specified',
    keywords: [...new Set([
      ...asArray(verified.keywords),
      ...asArray(verified.procurement_terms),
      ...asArray(verified.industries),
    ].map(text).filter(Boolean))],
    resident_state: text(verified.resident_state),
  };
}
