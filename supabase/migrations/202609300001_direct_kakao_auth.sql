-- Kakao OAuth is handled by the application server so non-Biz Kakao apps do
-- not have to request the account_email scope hard-coded by Supabase Auth.
create table public.kakao_accounts (
  kakao_id text primary key,
  user_id uuid unique not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

alter table public.kakao_accounts enable row level security;
revoke all on public.kakao_accounts from anon, authenticated;
grant all on public.kakao_accounts to service_role;
