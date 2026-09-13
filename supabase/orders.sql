-- ============================================================================
-- 娃娃收藏館 · 訂單表（綠界金流用）
-- 在 Supabase Dashboard → SQL Editor 貼上執行一次。
-- 訂單由 Edge Function 以 service role 建立/更新（繞過 RLS）；
-- RLS 只放行「買家或賣家本人」查看自己的訂單。
-- ============================================================================

create table if not exists public.doll_orders (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  merchant_trade_no text unique not null,          -- 送給綠界的訂單編號（<=20 英數）
  product_id        uuid references public.doll_products(id) on delete set null,
  product_title     text not null,
  seller_id         uuid references auth.users(id) on delete set null,
  seller_name       text,
  buyer_id          uuid references auth.users(id) on delete set null,
  buyer_email       text,
  amount            integer not null,               -- 買家支付（售價）
  fee_commission    integer not null default 0,     -- 平台成交手續費
  fee_payment       integer not null default 0,     -- 金流費
  seller_payout     integer not null default 0,     -- 賣家實收
  status            text not null default 'pending' check (status in ('pending','paid','failed')),
  ecpay_trade_no    text,                            -- 綠界交易編號
  payment_type      text,                            -- 付款方式（Credit/ATM…）
  paid_at           timestamptz
);

alter table public.doll_orders enable row level security;

drop policy if exists "dollorders_select_own" on public.doll_orders;
create policy "dollorders_select_own"
  on public.doll_orders for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- 不開放前端直接 insert/update；一律由 Edge Function（service role）處理。
