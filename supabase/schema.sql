-- Run once in the Supabase SQL editor (both the production and the test project).
-- All tables are accessed only by server functions using the service role key.
-- RLS is enabled with no policies, so anon/authenticated clients cannot read or write.

create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  monthly_quota integer not null default 10 check (monthly_quota >= 0),
  created_at timestamptz not null default now()
);

create table public.render_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month_key text not null,
  tts_calls integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index render_tickets_user_month_idx on public.render_tickets (user_id, month_key);

create table public.storyboard_calls (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index storyboard_calls_user_time_idx on public.storyboard_calls (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.render_tickets enable row level security;
alter table public.storyboard_calls enable row level security;

create or replace function public.thai_month_key()
returns text language sql stable as $$
  select to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
$$;

create or replace function public.issue_render_ticket(p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_quota integer;
  v_used integer;
  v_id uuid;
  v_month text := public.thai_month_key();
begin
  select monthly_quota into v_quota from public.profiles where user_id = p_user for update;
  if v_quota is null then raise exception 'profile_missing'; end if;
  select count(*) into v_used from public.render_tickets
    where user_id = p_user and month_key = v_month;
  if v_used >= v_quota then raise exception 'quota_exceeded'; end if;
  insert into public.render_tickets (user_id, month_key, expires_at)
    values (p_user, v_month, now() + interval '30 minutes')
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.consume_tts_call(p_ticket uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.render_tickets
     set tts_calls = tts_calls + 1
   where id = p_ticket and user_id = p_user
     and expires_at > now() and tts_calls < 24;
  if not found then raise exception 'ticket_invalid'; end if;
end $$;

create or replace function public.check_storyboard_rate(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_recent integer;
begin
  select count(*) into v_recent from public.storyboard_calls
    where user_id = p_user and created_at > now() - interval '1 hour';
  if v_recent >= 10 then raise exception 'rate_limited'; end if;
  insert into public.storyboard_calls (user_id) values (p_user);
end $$;

revoke all on function public.issue_render_ticket(uuid) from public, anon, authenticated;
revoke all on function public.consume_tts_call(uuid, uuid) from public, anon, authenticated;
revoke all on function public.check_storyboard_rate(uuid) from public, anon, authenticated;
