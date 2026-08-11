-- NGCC development reliability: persist derived mission execution evidence.
-- This is APROPOS operational state only. SAM.gov remains authoritative for market data.

alter table public.ngcc_procurement_missions
  add column if not exists operational_state jsonb not null default '{}'::jsonb;
