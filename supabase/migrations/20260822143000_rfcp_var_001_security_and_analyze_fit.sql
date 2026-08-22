-- RFCP-VAR-001 controlled remediation.
-- This migration intentionally preserves historical object names as technical
-- aliases while removing every browser-callable path that could grant verified
-- contractor status.

begin;

create table if not exists public.rfcp_sam_verification_events (
  id uuid primary key default gen_random_uuid(),
  verification_event_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  authoritative_source text not null,
  source_record_hash text not null,
  verification_result text not null check (verification_result in ('verified','rejected')),
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.rfcp_sam_verification_events enable row level security;
revoke all on public.rfcp_sam_verification_events from public, anon, authenticated;
grant select, insert on public.rfcp_sam_verification_events to service_role;

-- Preserve the old signature so stale browser clients fail closed. No submitted
-- field is inspected or persisted and the function can no longer be executed by
-- an end user.
create or replace function public.portal_apply_sam_profile(
  p_uei text, p_cage text, p_expires_at timestamptz,
  p_registered_naics text[], p_primary_naics text,
  p_registered_pscs text[], p_business_classifications text[],
  p_capability_profile jsonb, p_source text, p_version text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Authoritative server verification is required.';
end;
$$;
revoke all on function public.portal_apply_sam_profile(text,text,timestamptz,text[],text,text[],text[],jsonb,text,text) from public, anon, authenticated;
grant execute on function public.portal_apply_sam_profile(text,text,timestamptz,text[],text,text[],text[],jsonb,text,text) to service_role;

-- Only the service-role verification worker can invoke this grant operation.
-- The unique external event id supplies replay protection and the immutable
-- evidence row records the authoritative source and source-record digest.
create or replace function public.rfcp_apply_authoritative_sam_verification(
  p_user_id uuid,
  p_verification_event_id text,
  p_authoritative_source text,
  p_source_record_hash text,
  p_uei text,
  p_cage text,
  p_expires_at timestamptz,
  p_registered_naics text[],
  p_primary_naics text,
  p_registered_pscs text[],
  p_business_classifications text[],
  p_capability_profile jsonb,
  p_evidence jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service verification required.';
  end if;
  if p_user_id is null or nullif(btrim(p_verification_event_id), '') is null
     or nullif(btrim(p_authoritative_source), '') is null
     or nullif(btrim(p_source_record_hash), '') is null
     or nullif(btrim(p_uei), '') is null
     or p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'Complete, current authoritative evidence is required.';
  end if;

  insert into public.rfcp_sam_verification_events (
    verification_event_id, user_id, authoritative_source,
    source_record_hash, verification_result, evidence
  ) values (
    btrim(p_verification_event_id), p_user_id, btrim(p_authoritative_source),
    btrim(p_source_record_hash), 'verified', coalesce(p_evidence, '{}'::jsonb)
  ) returning id into v_event_id;

  insert into public.contractor_registrations (
    user_id, access_status, verified_uei, verified_cage_code,
    sam_registration_expires_at, verified_at, verification_notes,
    registered_naics, primary_naics, registered_pscs,
    business_classifications, capability_statement_source,
    capability_profile, sam_profile_synced_at, match_profile_version, updated_at
  ) values (
    p_user_id, 'verified', btrim(p_uei), nullif(btrim(p_cage), ''),
    p_expires_at, now(),
    'Authoritative SAM verification event ' || v_event_id::text,
    coalesce(p_registered_naics, '{}'), nullif(btrim(p_primary_naics), ''),
    coalesce(p_registered_pscs, '{}'), coalesce(p_business_classifications, '{}'),
    btrim(p_authoritative_source), coalesce(p_capability_profile, '{}'::jsonb), now(),
    'RFCP_SAM_AUTHORITATIVE_V1', now()
  )
  on conflict (user_id) do update set
    access_status = excluded.access_status,
    verified_uei = excluded.verified_uei,
    verified_cage_code = excluded.verified_cage_code,
    sam_registration_expires_at = excluded.sam_registration_expires_at,
    verified_at = excluded.verified_at,
    verification_notes = excluded.verification_notes,
    registered_naics = excluded.registered_naics,
    primary_naics = excluded.primary_naics,
    registered_pscs = excluded.registered_pscs,
    business_classifications = excluded.business_classifications,
    capability_statement_source = excluded.capability_statement_source,
    capability_profile = excluded.capability_profile,
    sam_profile_synced_at = excluded.sam_profile_synced_at,
    match_profile_version = excluded.match_profile_version,
    updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.rfcp_apply_authoritative_sam_verification(uuid,text,text,text,text,text,timestamptz,text[],text,text[],text[],jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.rfcp_apply_authoritative_sam_verification(uuid,text,text,text,text,text,timestamptz,text[],text,text[],text[],jsonb,jsonb) to service_role;

-- Reset is the only user-callable mutation. auth.uid() is mandatory and the
-- update predicate cannot name a different contractor.
create or replace function public.portal_reset_sam_profile() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  update public.contractor_registrations
     set access_status = 'pending_verification', verified_uei = null,
         verified_cage_code = null, sam_registration_expires_at = null,
         verified_at = null, verified_by = null,
         verification_notes = 'Business identity changed; authoritative SAM verification is required.',
         registered_naics = '{}', primary_naics = null, registered_pscs = '{}',
         business_classifications = '{}', capability_statement_source = null,
         capability_profile = '{}'::jsonb, sam_profile_synced_at = null,
         match_profile_version = null, updated_at = now()
   where user_id = v_user;
end;
$$;
revoke all on function public.portal_reset_sam_profile() from public, anon;
grant execute on function public.portal_reset_sam_profile() to authenticated, service_role;

-- Server-managed Analyze Fit access. Authorized test access is an entitlement,
-- never a fabricated ledger credit.
create table if not exists public.rfcp_analyze_fit_access (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  access_type text not null check (access_type in ('subscription','package','complimentary','authorized_test')),
  status text not null default 'active' check (status in ('active','expired','revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (customer_email, access_type, external_reference)
);
alter table public.rfcp_analyze_fit_access enable row level security;
revoke all on public.rfcp_analyze_fit_access from public, anon, authenticated;
grant select, insert, update on public.rfcp_analyze_fit_access to service_role;

create table if not exists public.rfcp_analyze_fit_requests (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  opportunity_key text not null check (opportunity_key ~ '^(federal|state_local):.+'),
  idempotency_key text not null,
  status text not null check (status in ('reserved','completed','released')),
  entitlement_basis text not null,
  credit_ledger_id uuid references public.analyze_fit_credit_ledger(id),
  release_ledger_id uuid references public.analyze_fit_credit_ledger(id),
  attempt_count integer not null default 1,
  reserved_at timestamptz not null default now(),
  completed_at timestamptz,
  released_at timestamptz,
  failure_code text,
  unique (customer_email, idempotency_key)
);
alter table public.rfcp_analyze_fit_requests enable row level security;
revoke all on public.rfcp_analyze_fit_requests from public, anon, authenticated;
grant select, insert, update on public.rfcp_analyze_fit_requests to service_role;

create or replace function public.rfcp_reserve_analyze_fit(
  p_customer_email text, p_opportunity_key text, p_idempotency_key text
) returns table(request_id uuid, request_status text, entitlement_basis text)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_customer_email));
  v_existing public.rfcp_analyze_fit_requests%rowtype;
  v_basis text;
  v_ledger_id uuid;
  v_balance integer;
  v_retry boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server authorization required.';
  end if;
  if v_email = '' or p_opportunity_key !~ '^(federal|state_local):.+' or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Invalid analysis reservation.';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_email || ':' || p_idempotency_key));
  select * into v_existing from public.rfcp_analyze_fit_requests
   where customer_email=v_email and idempotency_key=p_idempotency_key for update;
  if found and v_existing.status in ('reserved','completed') then
    return query select v_existing.id, v_existing.status, v_existing.entitlement_basis;
    return;
  end if;
  v_retry := found;

  select a.access_type into v_basis from public.rfcp_analyze_fit_access a
   where lower(a.customer_email)=v_email and a.status='active'
     and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
   order by a.created_at desc limit 1;
  if v_basis is null and exists (
    select 1 from public.product_entitlements e where lower(e.customer_email)=v_email
      and e.product_code='ngcc' and e.status in ('active','trialing')
      and (e.current_period_end is null or e.current_period_end>now())
  ) then v_basis := 'subscription_or_package'; end if;
  if v_basis is null then
    select coalesce(sum(l.credit_delta),0)::integer into v_balance
      from public.analyze_fit_credit_ledger l where lower(l.customer_email)=v_email and l.product_code='ngcc';
    if v_balance < 1 then raise exception using errcode='P0001', message='No Analyze Fit entitlement or credit is available.'; end if;
    insert into public.analyze_fit_credit_ledger(customer_email,product_code,credit_delta,reason,metadata)
      values(v_email,'ngcc',-1,'usage',jsonb_build_object('idempotency_key',p_idempotency_key,'opportunity_key',p_opportunity_key))
      returning id into v_ledger_id;
    v_basis := 'individual_credit';
  end if;

  if v_retry then
    update public.rfcp_analyze_fit_requests set status='reserved', entitlement_basis=v_basis,
      credit_ledger_id=v_ledger_id, release_ledger_id=null, attempt_count=attempt_count+1,
      reserved_at=now(), completed_at=null, released_at=null, failure_code=null
      where id=v_existing.id returning rfcp_analyze_fit_requests.id,rfcp_analyze_fit_requests.status,rfcp_analyze_fit_requests.entitlement_basis
      into request_id,request_status,entitlement_basis;
  else
    insert into public.rfcp_analyze_fit_requests(customer_email,opportunity_key,idempotency_key,status,entitlement_basis,credit_ledger_id)
      values(v_email,p_opportunity_key,p_idempotency_key,'reserved',v_basis,v_ledger_id)
      returning rfcp_analyze_fit_requests.id,rfcp_analyze_fit_requests.status,rfcp_analyze_fit_requests.entitlement_basis into request_id,request_status,entitlement_basis;
  end if;
  return next;
end; $$;

create or replace function public.rfcp_complete_analyze_fit(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then raise exception using errcode='42501',message='Server authorization required.'; end if;
  update public.rfcp_analyze_fit_requests set status='completed',completed_at=now()
   where id=p_request_id and status='reserved';
end; $$;

create or replace function public.rfcp_release_analyze_fit(p_request_id uuid,p_failure_code text) returns void
language plpgsql security definer set search_path='' as $$
declare v_row public.rfcp_analyze_fit_requests%rowtype; v_release uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then raise exception using errcode='42501',message='Server authorization required.'; end if;
  select * into v_row from public.rfcp_analyze_fit_requests where id=p_request_id for update;
  if not found or v_row.status<>'reserved' then return; end if;
  if v_row.credit_ledger_id is not null then
    insert into public.analyze_fit_credit_ledger(customer_email,product_code,credit_delta,reason,metadata)
      values(v_row.customer_email,'ngcc',1,'refund_reversal',jsonb_build_object('request_id',v_row.id,'failure_code',left(coalesce(p_failure_code,'analysis_failed'),120)))
      returning id into v_release;
  end if;
  update public.rfcp_analyze_fit_requests set status='released',released_at=now(),release_ledger_id=v_release,
    failure_code=left(coalesce(p_failure_code,'analysis_failed'),120) where id=v_row.id;
end; $$;

revoke all on function public.rfcp_reserve_analyze_fit(text,text,text) from public,anon,authenticated;
revoke all on function public.rfcp_complete_analyze_fit(uuid) from public,anon,authenticated;
revoke all on function public.rfcp_release_analyze_fit(uuid,text) from public,anon,authenticated;
grant execute on function public.rfcp_reserve_analyze_fit(text,text,text) to service_role;
grant execute on function public.rfcp_complete_analyze_fit(uuid) to service_role;
grant execute on function public.rfcp_release_analyze_fit(uuid,text) to service_role;

commit;
