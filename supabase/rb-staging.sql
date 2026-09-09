-- Phase 1: private source-preservation staging. NOT operational ERP tables.
-- Run once in Supabase SQL Editor. No workbook data is included here.
-- All changes are atomic. Existing schema causes failure instead of overwrite.
begin;
create schema rb_staging;
revoke all on schema rb_staging from public, anon, authenticated;

create table rb_staging.source_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz not null default now(),
  source_modified_at timestamptz,
  import_complete boolean not null default false
);

-- Preserve raw text, formula and cached result independently. No normalization
-- of item codes, leading zeros, units or error values at this stage.
create table rb_staging.source_cells (
  source_id uuid not null references rb_staging.source_files(id),
  sheet_name text not null,
  cell_address text not null check (cell_address ~ '^[A-Z]+[1-9][0-9]*$'),
  cell_type text,
  raw_value text,
  formula text,
  formula_attributes jsonb,
  primary key (source_id, sheet_name, cell_address)
);

create table rb_staging.review_issues (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references rb_staging.source_files(id),
  sheet_name text,
  cell_address text,
  issue_type text not null check (issue_type in
    ('missing_source','excel_error','duplicate_key','unresolved_link','formula_mismatch','other')),
  detail text not null,
  created_at timestamptz not null default now()
);
create index review_issues_source_idx on rb_staging.review_issues(source_id);

alter table rb_staging.source_files enable row level security;
alter table rb_staging.source_cells enable row level security;
alter table rb_staging.review_issues enable row level security;
revoke all on all tables in schema rb_staging from public, anon, authenticated;
-- No client policies: deny by default. Do not expose this schema via Data API.
-- Import will use a separately reviewed administrative process, not the browser.
commit;
