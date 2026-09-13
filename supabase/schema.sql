-- ============================================================================
-- 娃娃收藏館 · Supabase 後端建置（獨立命名，避免和專案內既有 products 表衝突）
-- 在 Supabase Dashboard → SQL Editor 貼上整段執行一次即可。
-- 會員驗證用 Supabase Auth（內建）；這裡建立 doll_products 表、權限(RLS)、圖片儲存桶。
-- ============================================================================

-- 1) 商品表 -------------------------------------------------------------------
create table if not exists public.doll_products (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  seller_id   uuid references auth.users(id) on delete set null,
  seller_name text not null default '會員',
  cat         text not null check (cat in ('barbie','blythe','bjd','accessory')),
  title       text not null,
  price       integer not null default 0 check (price >= 0),
  descr       text,
  image_url   text,
  for_sale    boolean not null default true
);

-- 2) 權限 Row Level Security --------------------------------------------------
alter table public.doll_products enable row level security;

drop policy if exists "dollprod_select_all" on public.doll_products;
create policy "dollprod_select_all"
  on public.doll_products for select
  using (true);                              -- 任何人（含未登入）都能瀏覽

drop policy if exists "dollprod_insert_own" on public.doll_products;
create policy "dollprod_insert_own"
  on public.doll_products for insert to authenticated
  with check (auth.uid() = seller_id);       -- 只能以自己身分刊登

drop policy if exists "dollprod_update_own" on public.doll_products;
create policy "dollprod_update_own"
  on public.doll_products for update to authenticated
  using (auth.uid() = seller_id);            -- 只能改自己的商品

drop policy if exists "dollprod_delete_own" on public.doll_products;
create policy "dollprod_delete_own"
  on public.doll_products for delete to authenticated
  using (auth.uid() = seller_id);            -- 只能刪自己的商品

-- 3) 商品圖片儲存桶 -----------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('doll-product-images', 'doll-product-images', true)
on conflict (id) do nothing;

drop policy if exists "dollimg_read" on storage.objects;
create policy "dollimg_read"
  on storage.objects for select
  using (bucket_id = 'doll-product-images');      -- 圖片公開可讀

drop policy if exists "dollimg_upload" on storage.objects;
create policy "dollimg_upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'doll-product-images'); -- 登入者才能上傳

-- 4) 展示種子資料（館藏＋範例商品；直接以 SQL 匯入，seller_id 留空）-----------
insert into public.doll_products (seller_name, cat, title, price, descr, for_sale) values
  ('館藏',    'barbie', '復刻經典芭比',   0,     '向初代芭比致敬的復刻款，黑白條紋泳裝與招牌馬尾。', false),
  ('Eugenie', 'barbie', '晚宴禮服芭比',   2800,  '華麗亮片禮服搭配長手套，收藏家系列的代表造型。',   true),
  ('Eugenie', 'barbie', '聯名限量芭比',   4500,  '品牌聯名的限量款式，附收藏證與專屬包裝。',         true),
  ('館藏',    'blythe', '原裝小布',       0,     '保留原廠妝容與眼片的原裝小布，變色拉繩完好。',     false),
  ('Momo',    'blythe', '訂製改娃小布',   6800,  '手繪重妝與植髮的訂製款，五官更柔和、獨一無二。',   true),
  ('Momo',    'blythe', 'Petite 迷你小布',1200,  '掌心大小的迷你版本，適合擺飾與外出拍照。',         true),
  ('Rin',     'bjd',    '1/3 SD 訂製娃',  12800, '1/3 尺寸球型關節娃，含頭雕、素體、開眉眼與訂製妝容。', true),
  ('Rin',     'bjd',    '1/4 MSD 少女頭', 5600,  'MSD 尺寸單頭雕，樹脂膚色接近粉膚，附原廠證卡。',   true),
  ('Sora',    'bjd',    '1/6 YOSD 全套',  3900,  'YOSD 小尺寸，附素體、假髮、眼珠與一套服裝，新手友善。', true),
  ('Sora',    'accessory','手作娃用洋裝（3件組）',850,'手工縫製洋裝三件組，適用小布與 1/6 BJD。',      true)
on conflict do nothing;
