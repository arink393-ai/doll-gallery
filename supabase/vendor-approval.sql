-- ============================================================================
-- 賣家進駐：開放制 ↔ 審核制 切換
-- 在 Supabase Dashboard → SQL Editor 貼上執行一次。
-- 預設「開放制」（任何會員可上架）；管理員可在後台切成「審核制」。
-- 審核制下：會員要先申請、經管理員核准，才能刊登商品/發起募資。
-- ============================================================================

-- 平台設定（單列）
create table if not exists public.doll_settings (
  id text primary key,
  require_vendor_approval boolean not null default false
);
insert into public.doll_settings (id, require_vendor_approval) values ('platform', false)
  on conflict (id) do nothing;
alter table public.doll_settings enable row level security;
drop policy if exists "settings_read_all" on public.doll_settings;
create policy "settings_read_all" on public.doll_settings for select using (true);
drop policy if exists "settings_admin_write" on public.doll_settings;
create policy "settings_admin_write" on public.doll_settings for update to authenticated
  using (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed')
  with check (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed');

-- 賣家申請/狀態
create table if not exists public.doll_vendors (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text,
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  applied_at timestamptz not null default now()
);
alter table public.doll_vendors enable row level security;
drop policy if exists "vendors_select_own_or_admin" on public.doll_vendors;
create policy "vendors_select_own_or_admin" on public.doll_vendors for select to authenticated
  using (auth.uid() = user_id or auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed');
drop policy if exists "vendors_insert_own" on public.doll_vendors;
create policy "vendors_insert_own" on public.doll_vendors for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "vendors_admin_update" on public.doll_vendors;
create policy "vendors_admin_update" on public.doll_vendors for update to authenticated
  using (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed')
  with check (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed');
drop policy if exists "vendors_admin_delete" on public.doll_vendors;
create policy "vendors_admin_delete" on public.doll_vendors for delete to authenticated
  using (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed');

-- 能否上架販售？（開放制=人人可；審核制=管理員或已核准賣家）
create or replace function public.can_sell(uid uuid) returns boolean
  language sql security definer stable as $$
  select
    (not coalesce((select require_vendor_approval from public.doll_settings where id = 'platform'), false))
    or uid = '99482e09-0df0-47bf-9e87-49e54ba94fed'::uuid
    or exists (select 1 from public.doll_vendors v where v.user_id = uid and v.status = 'approved');
$$;

-- 收緊「刊登商品 / 發起募資」的 insert：需通過 can_sell
-- 注意：原始 schema 的政策名是 dollprod_insert_own，一定要連它一起 drop，
-- 否則舊的寬鬆政策（只檢查 seller_id）會與新政策 OR，導致審核擋不住。
drop policy if exists "dollprod_insert_own" on public.doll_products;
drop policy if exists "products_insert_own" on public.doll_products;
create policy "products_insert_own" on public.doll_products for insert to authenticated
  with check (auth.uid() = seller_id and public.can_sell(auth.uid()));
drop policy if exists "campaigns_insert_own" on public.doll_campaigns;
create policy "campaigns_insert_own" on public.doll_campaigns for insert to authenticated
  with check (auth.uid() = creator_id and public.can_sell(auth.uid()));
