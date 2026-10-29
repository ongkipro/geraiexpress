-- Plain PostgreSQL prerequisites for the unchanged application migrations (ADR-0002 / T-064).
-- Run as postgres. Roles are cluster-wide and survive a local database reset; they carry no
-- password here (the runner provisions the local authenticator password from the gitignored env file).
do $roles$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator; end if;
  -- Legacy debt: old migrations grant their signup hook to this GoTrue role. No daemon uses it.
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if;
end $roles$;
alter role anon nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role authenticated nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- As on Supabase, the machine role bypasses RLS (the app's machine client reads public.tenants).
alter role service_role nologin nosuperuser nocreatedb nocreaterole noreplication bypassrls;
alter role supabase_auth_admin nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role authenticator login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant anon, authenticated, service_role to authenticator;

create schema extensions;
create extension pgcrypto with schema extensions;
revoke all on schema extensions from public;
grant usage on schema extensions to anon, authenticated, service_role;

revoke create on schema public from public;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default ACL for objects postgres creates in public. The existing migrations revoke the
-- anon/authenticated part exactly as they did there; service_role keeps table and sequence access.
-- No function default is granted or revoked here: 20261028110000 owns the global EXECUTE revoke (T-035),
-- so every migration before it sees the same function defaults it saw on Supabase.
-- Debt (TASKS.md): sequences stay granted to the API roles, as before.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
revoke all on schema auth from public;
-- RLS expressions need the two claim functions; these roles receive no auth table privileges.
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text not null default 'authenticated',
  role text not null default 'authenticated',
  email text,
  encrypted_password text not null default '',
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  email_change text not null default '',
  phone text,
  phone_change text not null default '',
  confirmation_token text not null default '',
  recovery_token text not null default '',
  email_change_token_new text not null default '',
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create unique index users_email_key on auth.users (lower(email)) where deleted_at is null;

-- The old SQL reads only user_id, factor_type and status. T-065 owns sealing and verification;
-- there is deliberately no plaintext GoTrue `secret` column or identities/OAuth table.
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp' check (factor_type = 'totp'),
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  secret_sealed text not null,
  last_used_step bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz
);
create index mfa_factors_user_idx on auth.mfa_factors (user_id);
alter table auth.users enable row level security;
alter table auth.mfa_factors enable row level security;
revoke all on all tables in schema auth from public, anon, authenticated, service_role;

create function auth.jwt() returns jsonb
language sql stable set search_path = ''
as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create function auth.uid() returns uuid
language sql stable set search_path = ''
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
revoke execute on function auth.jwt(), auth.uid() from public;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
