-- ============================================================================
-- 娃娃收藏館 · 棉花娃娃募資（集資開團）
-- 在 Supabase Dashboard → SQL Editor 貼上執行一次。
-- 募資專案公開可讀；贊助=用綠界付「單價×數量」，付款成功後由 Edge Function
-- 累加 pledged_qty（已預訂件數）。達標 = pledged_qty >= goal_qty。
-- ============================================================================

-- 1) 募資專案表 --------------------------------------------------------------
create table if not exists public.doll_campaigns (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  creator_id   uuid references auth.users(id) on delete set null,
  creator_name text not null default '團主',
  title        text not null,
  descr        text,
  image_url    text,
  unit_price   integer not null check (unit_price >= 0),  -- 每隻價格
  goal_qty     integer not null check (goal_qty > 0),     -- 最低開團量/目標件數
  pledged_qty  integer not null default 0,                -- 已預訂件數（由金流累加）
  deadline     timestamptz not null,                      -- 募資截止
  active       boolean not null default true
);

alter table public.doll_campaigns enable row level security;

drop policy if exists "campaigns_select_all" on public.doll_campaigns;
create policy "campaigns_select_all"
  on public.doll_campaigns for select using (true);          -- 任何人可瀏覽

drop policy if exists "campaigns_insert_own" on public.doll_campaigns;
create policy "campaigns_insert_own"
  on public.doll_campaigns for insert to authenticated
  with check (auth.uid() = creator_id);                      -- 會員可發起

drop policy if exists "campaigns_update_own" on public.doll_campaigns;
create policy "campaigns_update_own"
  on public.doll_campaigns for update to authenticated
  using (auth.uid() = creator_id);                           -- 團主可編輯自己的

drop policy if exists "campaigns_delete_own" on public.doll_campaigns;
create policy "campaigns_delete_own"
  on public.doll_campaigns for delete to authenticated
  using (auth.uid() = creator_id);                           -- 團主可刪自己的

-- 2) 訂單表加上募資欄位（贊助也是一筆訂單）----------------------------------
alter table public.doll_orders add column if not exists campaign_id uuid references public.doll_campaigns(id) on delete set null;
alter table public.doll_orders add column if not exists qty integer not null default 1;

-- 3) 範例募資專案 ------------------------------------------------------------
insert into public.doll_campaigns (creator_name, title, descr, unit_price, goal_qty, pledged_qty, deadline)
values
  ('棉花工房', '20cm 微笑棉花娃娃（無骨架）', '軟萌微笑臉，短毛絨布，附小吊牌。滿 50 隻開團生產。', 480, 50, 12,  now() + interval '21 days'),
  ('手作小舖', '15cm 睡眼棉花娃娃（可換裝）', '經典睡眼款，附一套basic服裝；滿 30 隻開團。',          520, 30, 27,  now() + interval '10 days'),
  ('娃服社',   '10cm 口袋棉花娃娃吊飾', '掌心尺寸、可掛包包的迷你棉花娃娃；滿 80 隻開團。',        260, 80, 5,   now() + interval '30 days')
on conflict do nothing;
