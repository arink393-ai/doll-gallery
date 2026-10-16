-- ============================================================================
-- 管理員全權：讓 arink393@gmail.com（Eugenie Chuang）能管理任何賣家的資料
-- 在 Supabase Dashboard → SQL Editor 貼上執行一次。
-- 這些 policy 與既有「本人限定」policy 是 OR 關係：賣家仍只能管自己的，
-- 管理員則能管全部（看/改/下架/刪 任何募資、商品、訂單）。
-- ============================================================================

-- 募資專案
drop policy if exists "campaigns_admin_all" on public.doll_campaigns;
create policy "campaigns_admin_all" on public.doll_campaigns for all to authenticated
  using (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed')
  with check (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed');

-- 商品
drop policy if exists "products_admin_all" on public.doll_products;
create policy "products_admin_all" on public.doll_products for all to authenticated
  using (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed')
  with check (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed');

-- 訂單（看全部賣家的成交/贊助）
drop policy if exists "orders_admin_all" on public.doll_orders;
create policy "orders_admin_all" on public.doll_orders for all to authenticated
  using (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed')
  with check (auth.uid() = '99482e09-0df0-47bf-9e87-49e54ba94fed');
