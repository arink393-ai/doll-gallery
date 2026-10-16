/* ==========================================================================
   娃娃收藏館 · Marketplace 前端邏輯（Supabase 版）
   - 會員：Supabase Auth（email/password）
   - 商品：doll_products 資料表（RLS 保護）
   - 圖片：Storage bucket doll-product-images（公開讀、登入寫）
   金流：目前只做「費用試算 + 結帳明細」，實際收款待串接台灣金流商後啟用。
   ========================================================================== */

/* ---------- 費率設定（預設值，之後可調） ---------- */
const FEES = {
  listing: 0,           // 刊登費：免費
  commissionRate: 0.05, // 成交手續費 5%
  paymentRate: 0.025,   // 金流費率 2.5%
  paymentFixed: 5,      // 金流固定費 NT$5
};

/* ---------- Supabase 連線 ---------- */
const CFG = window.DG_CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

/* ---------- 執行期狀態 ---------- */
let SESSION = null;   // 目前登入 session
let PRODUCTS = [];    // 從資料庫載入的商品（已正規化）
const ADMIN_ID = '99482e09-0df0-47bf-9e87-49e54ba94fed';  // 管理員帳號（棉花娃娃工坊）
function isAdmin() { return SESSION?.user?.id === ADMIN_ID; }

/* ---------- 小工具 ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const money = n => 'NT$' + Math.round(n).toLocaleString('en-US');
const CAT_CLASS = { barbie:'pink', blythe:'blue', bjd:'bjd', accessory:'bjd' };
const CAT_NAME  = { barbie:'芭比', blythe:'小布', bjd:'BJD', accessory:'配件/服裝' };
const CAT_EMOJI = { barbie:'👗', blythe:'🌸', bjd:'🎎', accessory:'👜' };
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function userName(u){ return u?.user_metadata?.name || (u?.email ? u.email.split('@')[0] : '會員'); }

function feeBreakdown(price) {
  const commission = price * FEES.commissionRate;
  const payment = price * FEES.paymentRate + FEES.paymentFixed;
  const payout = price - commission - payment;
  return { price, commission, payment, payout };
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

/* 把資料庫列正規化成畫面用的物件 */
function normalize(row) {
  return {
    id: row.id, cat: row.cat, title: row.title, price: row.price,
    desc: row.descr, image: row.image_url, forSale: row.for_sale,
    sellerId: row.seller_id, sellerName: row.seller_name,
    tag: CAT_NAME[row.cat] || row.cat,
    emoji: CAT_EMOJI[row.cat] || '🎎',
    meta: (row.for_sale ? CAT_NAME[row.cat] + ' · 會員刊登' : CAT_NAME[row.cat] + ' · 館藏展示'),
  };
}

/* ---------- 資料載入 ---------- */
async function loadProducts() {
  const { data, error } = await sb.from(CFG.TABLE).select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('loadProducts', error);
    toast('讀取商品失敗：' + error.message);
    PRODUCTS = []; return;
  }
  PRODUCTS = data.map(normalize);
}
async function refreshSession() {
  const { data } = await sb.auth.getSession();
  SESSION = data.session;
}

/* ---------- Auth ---------- */
async function doRegister(name, email, pass) {
  const { data, error } = await sb.auth.signUp({
    email, password: pass, options: { data: { name: name || email.split('@')[0] } },
  });
  if (error) throw error;
  if (!data.session) {
    // Email 驗證未關閉的情況
    throw new Error('註冊成功，但這個專案還開著「Email 驗證」。請到 Supabase → Authentication → Email 關閉 Confirm email，或收信完成驗證後再登入。');
  }
  SESSION = data.session;
}
async function doLogin(email, pass) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    if (/confirm/i.test(error.message)) throw new Error('這個帳號尚未完成 Email 驗證。可到 Supabase 關閉 Confirm email，或收信驗證後再登入。');
    throw new Error('Email 或密碼錯誤。');
  }
  SESSION = data.session;
}
async function doLogout() { await sb.auth.signOut(); SESSION = null; }

/* ---------- 渲染：導覽列帳號區 ---------- */
function renderAccount() {
  const el = $('#navAccount'); const u = SESSION?.user;
  if (u) {
    const adminBtn = isAdmin() ? '<button class="link-btn" id="accAdmin" style="color:var(--barbie)">管理</button>' : '';
    el.innerHTML = `<span class="who">👤 ${escapeHtml(userName(u))}</span>
      ${adminBtn}
      <button class="link-btn" id="accMine">我的</button>
      <button class="btn btn-dark btn-sm" id="accSell">刊登</button>
      <button class="link-btn" id="accLogout">登出</button>`;
    if (isAdmin()) $('#accAdmin').onclick = openAdmin;
    $('#accMine').onclick = openAccount;
    $('#accSell').onclick = openSell;
    $('#accLogout').onclick = async () => { await doLogout(); renderAccount(); toast('已登出'); };
  } else {
    el.innerHTML = `<button class="link-btn" id="accLogin">登入</button>
      <button class="btn btn-dark btn-sm" id="accReg">註冊</button>`;
    $('#accLogin').onclick = () => openAuth('login');
    $('#accReg').onclick = () => openAuth('register');
  }
}

/* ---------- 渲染：卡片 ---------- */
function cardHtml(p) {
  const cls = CAT_CLASS[p.cat] || 'bjd';
  const bg = p.image ? `style="background-image:url('${escapeHtml(p.image)}')"` : '';
  const priceTag = p.forSale ? `<span class="price-tag">${money(p.price)}</span>` : '';
  const emoji = p.image ? '' : (p.emoji || '🎎');
  const action = p.forSale
    ? `<button class="btn btn-dark btn-sm" data-buy="${p.id}">查看 / 購買</button>`
    : `<span class="seller">館藏展示</span>`;
  return `<article class="doll ${cls}">
    <div class="photo" ${bg}>${emoji}<span class="tag">${escapeHtml(p.tag)}</span>${priceTag}</div>
    <div class="body">
      <h4>${escapeHtml(p.title)}</h4>
      <p class="meta">${escapeHtml(p.meta)}</p>
      <p class="desc">${escapeHtml(p.desc)}</p>
      <div class="row">
        <span class="seller">賣家：${escapeHtml(p.sellerName || '—')}</span>
        ${action}
      </div>
    </div>
  </article>`;
}
function renderZones() {
  ['barbie','blythe','bjd'].forEach(cat => {
    const grid = $('#grid-' + cat);
    grid.innerHTML = PRODUCTS.filter(p => p.cat === cat).map(cardHtml).join('')
      || `<p class="seller" style="grid-column:1/-1;color:var(--muted)">這個專區還沒有娃娃，快來刊登第一隻！</p>`;
  });
  bindBuyButtons();
}
let currentCat = 'all';
function renderMarket() {
  const all = PRODUCTS.filter(p => p.forSale);
  const list = currentCat === 'all' ? all : all.filter(p => p.cat === currentCat);
  $('#grid-market').innerHTML = list.map(cardHtml).join('');
  $('#mktEmpty').hidden = list.length > 0;
  $('#statItems').textContent = all.length;
  bindBuyButtons();
}
function bindBuyButtons() {
  $$('[data-buy]').forEach(b => b.onclick = () => openDetail(b.dataset.buy));
}

/* ---------- Modal 基礎 ---------- */
function openModal(id){ $('#'+id).classList.add('open'); }
function closeModal(el){ el.classList.remove('open'); }
$$('.modal-back').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) closeModal(m); });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal-back.open').forEach(closeModal); });

/* ---------- Auth Modal ---------- */
let authMode = 'login';
function openAuth(mode) {
  authMode = mode; $('#authErr').textContent = '';
  const reg = mode === 'register';
  $('#authTitle').textContent = reg ? '註冊新帳號' : '會員登入';
  $('#authSub').textContent = reg ? '建立帳號後即可刊登與購買商品。' : '登入後即可刊登商品、管理你的販售。';
  $('#nameField').hidden = !reg;
  $('#authSubmit').textContent = reg ? '註冊並登入' : '登入';
  $('#authSwitchText').textContent = reg ? '已經有帳號了？' : '還沒有帳號？';
  $('#authSwitch').textContent = reg ? '改用登入' : '註冊新帳號';
  openModal('authModal');
}
$('#authSwitch').onclick = () => openAuth(authMode === 'login' ? 'register' : 'login');
$('#authSubmit').onclick = async () => {
  const name = $('#authName').value.trim();
  const email = $('#authEmail').value.trim();
  const pass = $('#authPass').value;
  const err = $('#authErr'); err.textContent = '';
  if (!email || !pass) { err.textContent = '請輸入 Email 與密碼。'; return; }
  if (pass.length < 6) { err.textContent = '密碼至少 6 碼。'; return; }
  const btn = $('#authSubmit'); btn.disabled = true; const label = btn.textContent; btn.textContent = '處理中…';
  try {
    if (authMode === 'register') await doRegister(name, email, pass);
    else await doLogin(email, pass);
    closeModal($('#authModal')); renderAccount();
    toast(authMode === 'register' ? '註冊成功，已登入' : '登入成功');
    if (pendingAction) { const a = pendingAction; pendingAction = null; a(); }
  } catch (e) { err.textContent = e.message || String(e); }
  finally { btn.disabled = false; btn.textContent = label; }
};

/* 需要登入才能做的動作 */
let pendingAction = null;
function requireLogin(action) {
  if (SESSION?.user) { action(); }
  else { pendingAction = action; openAuth('login'); toast('請先登入或註冊'); }
}

/* ---------- Sell / Upload Modal ---------- */
let uploadedFile = null;   // 實際 File 物件（上傳 Storage 用）
let editingId = null;      // 非 null = 編輯既有商品
function openSell() {
  requireLogin(() => {
    editingId = null; uploadedFile = null;
    $('#sellTitle').textContent = '刊登商品';
    $('#sellSubmit').textContent = '確認刊登（免費）';
    $('#pTitle').value=''; $('#pPrice').value=''; $('#pDesc').value='';
    $('#pCat').value='bjd'; $('#pPreview').innerHTML=''; $('#pDrop').classList.remove('has');
    $('#sellErr').textContent='';
    updateSellFeeHint();
    openModal('sellModal');
  });
}
function openEditProduct(id) {
  const p = PRODUCTS.find(x => x.id === id); if (!p) return;
  editingId = id; uploadedFile = null;
  $('#sellTitle').textContent = '編輯商品';
  $('#sellSubmit').textContent = '儲存變更';
  $('#pTitle').value = p.title; $('#pPrice').value = p.price; $('#pDesc').value = p.desc || '';
  $('#pCat').value = p.cat;
  $('#pPreview').innerHTML = p.image ? `<img src="${escapeHtml(p.image)}" alt="預覽">` : '';
  $('#pDrop').classList.toggle('has', !!p.image);
  $('#sellErr').textContent='';
  updateSellFeeHint();
  closeModal($('#accountModal'));
  openModal('sellModal');
}
$('#heroSell').onclick = openSell;
$('#mktSell').onclick = openSell;
$('#pDrop').onclick = () => $('#pFile').click();
$('#pFile').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 2.5 * 1024 * 1024) { $('#sellErr').textContent = '圖片請小於 2.5MB。'; return; }
  uploadedFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    $('#pPreview').innerHTML = `<img src="${reader.result}" alt="預覽">`;
    $('#pDrop').classList.add('has'); $('#sellErr').textContent='';
  };
  reader.readAsDataURL(file);
};
$('#pPrice').oninput = updateSellFeeHint;
function updateSellFeeHint() {
  const price = +$('#pPrice').value || 0;
  if (!price) { $('#pFeeHint').textContent = '刊登免費；成交時收取手續費與金流費。'; return; }
  const f = feeBreakdown(price);
  $('#pFeeHint').innerHTML = `成交後你實收約 <b>${money(f.payout)}</b>（已扣手續費 ${money(f.commission)} + 金流費 ${money(f.payment)}）`;
}
$('#sellSubmit').onclick = async () => {
  const title = $('#pTitle').value.trim();
  const cat = $('#pCat').value;
  const price = +$('#pPrice').value || 0;
  const desc = $('#pDesc').value.trim();
  const err = $('#sellErr'); err.textContent='';
  if (!title) { err.textContent='請輸入商品名稱。'; return; }
  if (price <= 0) { err.textContent='請輸入有效售價。'; return; }
  const user = SESSION?.user;
  if (!user) { err.textContent='請先登入。'; return; }
  const btn = $('#sellSubmit'); btn.disabled = true; const label = btn.textContent; btn.textContent = editingId ? '儲存中…' : '上架中…';
  try {
    let image_url = null;
    if (uploadedFile) {
      const ext = (uploadedFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from(CFG.BUCKET).upload(path, uploadedFile, { cacheControl:'3600', upsert:false });
      if (upErr) throw new Error('圖片上傳失敗：' + upErr.message);
      image_url = sb.storage.from(CFG.BUCKET).getPublicUrl(path).data.publicUrl;
    }
    if (editingId) {
      const patch = { cat, title, price, descr: desc };
      if (image_url) patch.image_url = image_url;   // 沒換圖就保留原圖
      const { error } = await sb.from(CFG.TABLE).update(patch).eq('id', editingId);
      if (error) throw new Error('更新失敗：' + error.message);
      await loadProducts(); renderZones(); renderMarket();
      closeModal($('#sellModal'));
      toast('已更新商品');
      if ($('#accountModal').classList.contains('open')) renderAcct();
    } else {
      const { error } = await sb.from(CFG.TABLE).insert({
        seller_id: user.id, seller_name: userName(user),
        cat, title, price, descr: desc, image_url, for_sale: true,
      });
      if (error) throw new Error('刊登失敗：' + error.message);
      await loadProducts(); renderZones(); renderMarket();
      closeModal($('#sellModal'));
      toast('刊登成功！商品已上架商城');
      document.getElementById('market').scrollIntoView({ behavior:'smooth' });
    }
  } catch (e) { err.textContent = e.message || String(e); }
  finally { btn.disabled = false; btn.textContent = label; }
};

/* ---------- Detail / Checkout Modal ---------- */
function openDetail(id) {
  const p = PRODUCTS.find(x => x.id === id); if (!p) return;
  const cls = CAT_CLASS[p.cat] || 'bjd';
  const f = feeBreakdown(p.price);
  $('#detailBody').innerHTML = `
    <div class="detail-photo ${p.image?'':cls}" ${p.image?`style="background-image:url('${escapeHtml(p.image)}')"`:''}>${p.image?'':(p.emoji||'🎎')}</div>
    <h3>${escapeHtml(p.title)}</h3>
    <p class="sub">${escapeHtml(CAT_NAME[p.cat])} · 賣家 ${escapeHtml(p.sellerName)}</p>
    <p style="color:#5c4a4a;font-size:.92rem">${escapeHtml(p.desc)}</p>
    <div style="font-family:var(--serif);font-size:1.8rem;margin:6px 0">${money(p.price)}</div>
    <div class="fee-mini">
      <div class="r"><span>買家支付</span><b>${money(p.price)}</b></div>
      <div class="r" style="color:var(--muted)"><span>· 平台成交手續費 (5%)</span><span>${money(f.commission)}</span></div>
      <div class="r" style="color:var(--muted)"><span>· 金流處理費 (2.5%+NT$5)</span><span>${money(f.payment)}</span></div>
      <div class="r total"><span>賣家實收</span><span style="color:var(--green)">${money(f.payout)}</span></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>關閉</button>
      <button class="btn btn-green" id="buyNow">立即購買</button>
    </div>
    <p class="hint" style="margin-top:12px;font-size:.78rem">※ 目前為綠界「測試環境」：可用測試卡走完整付款流程，不會產生真實款項。換上正式金鑰後即為真實收款。</p>`;
  openModal('detailModal');
  $('#detailModal [data-close]').onclick = () => closeModal($('#detailModal'));
  $('#buyNow').onclick = () => requireLogin(() => {
    if (SESSION.user.id === p.sellerId) { toast('這是你自己刊登的商品'); return; }
    startCheckout({ product_id: p.id }, '#buyNow');
  });
}

/* 呼叫綠界結帳 Edge Function，取得付款參數後自動導向綠界。
   body = {product_id} 或 {campaign_id, qty}；btnSel = 要顯示 loading 的按鈕 */
async function startCheckout(body, btnSel) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('請先登入'); return; }
  const btn = btnSel ? $(btnSel) : null; const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '前往付款…'; }
  try {
    const resp = await fetch(`${CFG.SUPABASE_URL}/functions/v1/ecpay-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CFG.SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const out = await resp.json();
    if (!resp.ok || out.error) { toast(out.error || '結帳失敗'); if (btn) { btn.disabled = false; btn.textContent = label; } return; }
    // 建立隱藏表單、自動 POST 導向綠界付款頁
    const form = document.createElement('form');
    form.method = 'POST'; form.action = out.action; form.style.display = 'none';
    for (const k in out.params) {
      const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = out.params[k]; form.appendChild(i);
    }
    document.body.appendChild(form); form.submit();
  } catch (e) {
    toast('結帳錯誤：' + e.message); if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

/* 從綠界付款頁返回時，顯示結果 */
async function checkPaidReturn() {
  const mtn = new URLSearchParams(location.search).get('paid');
  if (!mtn) return;
  history.replaceState({}, '', location.pathname + location.hash);
  let order = null;
  for (let i = 0; i < 5; i++) {
    const { data } = await sb.from('doll_orders').select('status,product_title').eq('merchant_trade_no', mtn).maybeSingle();
    if (data) { order = data; if (data.status === 'paid') break; }
    await new Promise(r => setTimeout(r, 1500));
  }
  if (order?.status === 'paid') toast(`付款成功！「${order.product_title}」`);
  else if (order) toast('付款處理中，稍後可在訂單查看狀態');
  else toast('已從綠界返回');
  // 可能是募資贊助 → 重新載入進度
  await loadCampaigns(); renderCampaigns();
}

/* ---------- 管理後台（限管理員） ---------- */
let adminTab = 'campaigns';
function openAdmin() {
  if (!isAdmin()) { toast('僅限管理員'); return; }
  adminTab = 'campaigns';
  $$('#adminTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.atab === adminTab));
  $('#adminBody').innerHTML = '<div class="acct-empty">載入中…</div>';
  openModal('adminModal');
  renderAdmin();
}
$('#adminTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  adminTab = t.dataset.atab;
  $$('#adminTabs .tab').forEach(x => x.classList.toggle('active', x === t));
  renderAdmin();
});

async function renderAdmin() {
  const body = $('#adminBody');
  body.innerHTML = '<div class="acct-empty">載入中…</div>';

  if (adminTab === 'campaigns') {
    const { data, error } = await sb.from('doll_campaigns').select('*').order('created_at', { ascending: false });
    if (error) { body.innerHTML = `<div class="acct-empty">讀取失敗：${escapeHtml(error.message)}</div>`; return; }
    if (!data.length) { body.innerHTML = '<div class="acct-empty">目前沒有募資專案。</div>'; return; }
    body.innerHTML = `<div class="acct-list">${data.map(c => {
      const pct = Math.min(100, Math.round(c.pledged_qty / c.goal_qty * 100));
      const thumb = c.image_url ? `style="background-image:url('${escapeHtml(c.image_url)}');background-size:cover"` : '';
      return `<div class="acct-row">
        <div class="thumb" ${thumb}>${c.image_url ? '' : '🧸'}</div>
        <div class="info"><h4>${escapeHtml(c.title)}</h4>
          <div class="sub">團主 ${escapeHtml(c.creator_name)} · ${money(c.unit_price)}/隻 · 已預訂 ${c.pledged_qty}/${c.goal_qty}（${pct}%） · ${c.active ? '<span class="pill on">進行中</span>' : '<span class="pill off">已關閉</span>'}</div>
        </div>
        <div class="acts">
          <button class="mini-btn" data-ctoggle="${c.id}" data-cur="${c.active}">${c.active ? '關閉' : '重開'}</button>
          <button class="mini-btn danger" data-cdel="${c.id}">刪除</button>
        </div>
      </div>`;
    }).join('')}</div>`;
    body.querySelectorAll('[data-ctoggle]').forEach(b => b.onclick = () => adminToggleCampaign(b.dataset.ctoggle, b.dataset.cur === 'true'));
    body.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => adminDeleteCampaign(b.dataset.cdel));
    return;
  }

  if (adminTab === 'products') {
    const { data, error } = await sb.from(CFG.TABLE).select('*').order('created_at', { ascending: false });
    if (error) { body.innerHTML = `<div class="acct-empty">讀取失敗：${escapeHtml(error.message)}</div>`; return; }
    if (!data.length) { body.innerHTML = '<div class="acct-empty">目前沒有商品。</div>'; return; }
    body.innerHTML = `<div class="acct-list">${data.map(r => {
      const p = normalize(r);
      const thumb = p.image ? `style="background-image:url('${escapeHtml(p.image)}');background-size:cover"` : '';
      return `<div class="acct-row">
        <div class="thumb" ${thumb}>${p.image ? '' : p.emoji}</div>
        <div class="info"><h4>${escapeHtml(p.title)}</h4>
          <div class="sub">賣家 ${escapeHtml(p.sellerName || '—')} · ${escapeHtml(CAT_NAME[p.cat])} · ${money(p.price)} · ${r.for_sale ? '<span class="pill on">販售中</span>' : '<span class="pill off">已下架</span>'}</div>
        </div>
        <div class="acts">
          <button class="mini-btn" data-ptoggle="${p.id}" data-cur="${r.for_sale}">${r.for_sale ? '下架' : '上架'}</button>
          <button class="mini-btn danger" data-pdel="${p.id}">刪除</button>
        </div>
      </div>`;
    }).join('')}</div>`;
    body.querySelectorAll('[data-ptoggle]').forEach(b => b.onclick = () => adminToggleProduct(b.dataset.ptoggle, b.dataset.cur === 'true'));
    body.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => adminDeleteProduct(b.dataset.pdel));
    return;
  }

  // orders（需要已跑 admin-rls SQL 才讀得到全部）
  const { data, error } = await sb.from('doll_orders').select('*').order('created_at', { ascending: false });
  if (error) { body.innerHTML = `<div class="acct-empty">讀取失敗：${escapeHtml(error.message)}</div>`; return; }
  if (!data.length) { body.innerHTML = '<div class="acct-empty">目前沒有訂單。<br><span style="font-size:.8rem">（若剛開通管理員權限，請確認已跑 admin-rls SQL）</span></div>'; return; }
  body.innerHTML = `<div class="acct-list">${data.map(o => `
    <div class="acct-row">
      <div class="thumb">${o.campaign_id ? '🧸' : '🛍️'}</div>
      <div class="info"><h4>${escapeHtml(o.product_title)}</h4>
        <div class="sub">買家 ${escapeHtml(o.buyer_email || '—')} → 賣家 ${escapeHtml(o.seller_name || '—')} · ${money(o.amount)}（實收 ${money(o.seller_payout)}） · ${orderDate(o)}</div>
      </div>
      <div class="acts">${statusPill(o.status)}</div>
    </div>`).join('')}</div>`;
}

async function adminToggleCampaign(id, cur) {
  const { error } = await sb.from('doll_campaigns').update({ active: !cur }).eq('id', id);
  if (error) { toast('操作失敗：' + error.message); return; }
  await loadCampaigns(); renderCampaigns(); renderAdmin(); toast(cur ? '已關閉募資' : '已重新開放');
}
async function adminDeleteCampaign(id) {
  if (!window.confirm('確定刪除這個募資專案嗎？此動作無法復原。')) return;
  const { error } = await sb.from('doll_campaigns').delete().eq('id', id);
  if (error) { toast('刪除失敗：' + error.message); return; }
  await loadCampaigns(); renderCampaigns(); renderAdmin(); toast('已刪除募資');
}
async function adminToggleProduct(id, cur) {
  const { error } = await sb.from(CFG.TABLE).update({ for_sale: !cur }).eq('id', id);
  if (error) { toast('操作失敗：' + error.message); return; }
  await loadProducts(); renderZones(); renderMarket(); renderAdmin(); toast(cur ? '已下架' : '已上架');
}
async function adminDeleteProduct(id) {
  if (!window.confirm('確定刪除這件商品嗎？此動作無法復原。')) return;
  const { error } = await sb.from(CFG.TABLE).delete().eq('id', id);
  if (error) { toast('刪除失敗：' + error.message); return; }
  await loadProducts(); renderZones(); renderMarket(); renderAdmin(); toast('已刪除商品');
}

/* ---------- 棉花娃娃募資 Crowdfunding ---------- */
const DAY_MS = 86400000;
let CAMPAIGNS = [];
async function loadCampaigns() {
  const { data, error } = await sb.from('doll_campaigns').select('*').eq('active', true).order('created_at', { ascending: false });
  if (error) { console.error('loadCampaigns', error); CAMPAIGNS = []; return; }
  CAMPAIGNS = data;
}
function campState(c) {
  const left = Math.ceil((new Date(c.deadline).getTime() - Date.now()) / DAY_MS);
  return { left, funded: c.pledged_qty >= c.goal_qty, ended: left < 0 };
}
function renderCampaigns() {
  const grid = $('#grid-campaigns'), empty = $('#cfEmpty');
  if (!grid) return;
  empty.hidden = CAMPAIGNS.length > 0;
  grid.innerHTML = CAMPAIGNS.map(c => {
    const { left, funded, ended } = campState(c);
    const pct = Math.min(100, Math.round(c.pledged_qty / c.goal_qty * 100));
    const bg = c.image_url ? `style="background-image:url('${escapeHtml(c.image_url)}')"` : '';
    const emoji = c.image_url ? '' : '🧸';
    const deadlineTag = ended ? '已截止' : `剩 ${left} 天`;
    const statusLine = funded ? '<span class="done">✓ 已達標</span>' : (ended ? '<span class="ended">未達標</span>' : `<span class="pct">${pct}%</span>`);
    const btn = ended ? '<button class="btn btn-ghost btn-sm" disabled>已截止</button>'
      : `<button class="btn btn-pink btn-sm" data-pledge="${c.id}">我要贊助</button>`;
    return `<article class="camp">
      <div class="photo" ${bg}>${emoji}<span class="deadline">${deadlineTag}</span></div>
      <div class="body">
        <h4>${escapeHtml(c.title)}</h4>
        <div class="price">${money(c.unit_price)} <span>/ 隻</span></div>
        <p class="desc">${escapeHtml(c.descr || '')}</p>
        <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
        <div class="prog-txt"><span>已預訂 <b>${c.pledged_qty}</b> / ${c.goal_qty} 隻</span>${statusLine}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:.78rem;color:var(--muted)">團主：${escapeHtml(c.creator_name)}</span>
          ${btn}
        </div>
      </div>
    </article>`;
  }).join('');
  grid.querySelectorAll('[data-pledge]').forEach(b => b.onclick = () => openPledge(b.dataset.pledge));
}

/* 發起募資 */
let cImage = null;
function openCampaign() {
  requireLogin(() => {
    cImage = null;
    $('#cTitle').value = ''; $('#cPrice').value = ''; $('#cGoal').value = ''; $('#cDesc').value = '';
    $('#cDeadline').value = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10);
    $('#cPreview').innerHTML = ''; $('#cDrop').classList.remove('has'); $('#campErr').textContent = '';
    openModal('campModal');
  });
}
$('#cfStart').onclick = openCampaign;
$('#cDrop').onclick = () => $('#cFile').click();
$('#cFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 2.5 * 1024 * 1024) { $('#campErr').textContent = '圖片請小於 2.5MB。'; return; }
  cImage = f;
  const r = new FileReader();
  r.onload = () => { $('#cPreview').innerHTML = `<img src="${r.result}" alt="預覽">`; $('#cDrop').classList.add('has'); $('#campErr').textContent = ''; };
  r.readAsDataURL(f);
};
$('#campSubmit').onclick = async () => {
  const title = $('#cTitle').value.trim();
  const price = +$('#cPrice').value || 0;
  const goal = parseInt($('#cGoal').value) || 0;
  const desc = $('#cDesc').value.trim();
  const deadline = $('#cDeadline').value;
  const err = $('#campErr'); err.textContent = '';
  if (!title) { err.textContent = '請輸入專案名稱。'; return; }
  if (price <= 0) { err.textContent = '請輸入每隻價格。'; return; }
  if (goal <= 0) { err.textContent = '請輸入最低開團量。'; return; }
  if (!deadline) { err.textContent = '請選擇募資截止日。'; return; }
  const user = SESSION.user;
  const btn = $('#campSubmit'); btn.disabled = true; const label = btn.textContent; btn.textContent = '建立中…';
  try {
    let image_url = null;
    if (cImage) {
      const ext = (cImage.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${user.id}/camp_${Date.now()}.${ext}`;
      const { error: up } = await sb.storage.from(CFG.BUCKET).upload(path, cImage, { cacheControl: '3600', upsert: false });
      if (up) throw new Error('圖片上傳失敗：' + up.message);
      image_url = sb.storage.from(CFG.BUCKET).getPublicUrl(path).data.publicUrl;
    }
    const deadlineISO = new Date(deadline + 'T23:59:59').toISOString();
    const { error } = await sb.from('doll_campaigns').insert({
      creator_id: user.id, creator_name: userName(user),
      title, descr: desc, image_url, unit_price: price, goal_qty: goal, deadline: deadlineISO,
    });
    if (error) throw new Error('發起失敗：' + error.message);
    await loadCampaigns(); renderCampaigns();
    closeModal($('#campModal'));
    toast('募資已發起！');
    document.getElementById('crowdfund').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { err.textContent = e.message || String(e); }
  finally { btn.disabled = false; btn.textContent = label; }
};

/* 贊助 */
function openPledge(id) {
  const c = CAMPAIGNS.find(x => x.id === id); if (!c) return;
  requireLogin(() => {
    let qty = 1;
    const render = () => {
      const total = c.unit_price * qty;
      $('#pledgeBody').innerHTML = `
        <h3>贊助 · ${escapeHtml(c.title)}</h3>
        <p class="sub">${money(c.unit_price)} / 隻 · 已預訂 ${c.pledged_qty}/${c.goal_qty} 隻</p>
        <div class="qty-row">
          <button id="qMinus" type="button">−</button>
          <input id="qInput" type="number" min="1" max="99" value="${qty}">
          <button id="qPlus" type="button">＋</button>
          <span style="margin-left:auto;font-family:var(--serif);font-size:1.4rem">${money(total)}</span>
        </div>
        <div class="fee-mini">
          <div class="r"><span>贊助數量</span><b>${qty} 隻</b></div>
          <div class="r total"><span>應付金額</span><span>${money(total)}</span></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>取消</button>
          <button class="btn btn-pink" id="pledgePay">用綠界贊助</button>
        </div>
        <p class="hint" style="margin-top:12px;font-size:.78rem">※ 綠界測試環境：可走完整流程但不收真實款項。未達標由團主退款。</p>`;
      $('#pledgeModal [data-close]').onclick = () => closeModal($('#pledgeModal'));
      $('#qMinus').onclick = () => { qty = Math.max(1, qty - 1); render(); };
      $('#qPlus').onclick = () => { qty = Math.min(99, qty + 1); render(); };
      $('#qInput').oninput = e => { qty = Math.max(1, Math.min(99, parseInt(e.target.value) || 1)); };
      $('#pledgePay').onclick = () => startCheckout({ campaign_id: c.id, qty }, '#pledgePay');
    };
    render();
    openModal('pledgeModal');
  });
}

/* ---------- Account (我的) Modal ---------- */
let acctTab = 'listings';
function openAccount() {
  requireLogin(() => {
    acctTab = 'listings';
    $$('#acctTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === acctTab));
    $('#acctWho').textContent = `${userName(SESSION.user)}（${SESSION.user.email}）`;
    $('#acctBody').innerHTML = '<div class="acct-empty">載入中…</div>';
    openModal('accountModal');
    renderAcct();
  });
}
$('#acctTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  acctTab = t.dataset.tab;
  $$('#acctTabs .tab').forEach(x => x.classList.toggle('active', x === t));
  renderAcct();
});

const statusPill = s => ({ paid:'<span class="pill paid">已付款</span>', pending:'<span class="pill pending">待付款</span>', failed:'<span class="pill failed">未完成</span>' }[s] || '');
const orderDate = o => new Date(o.created_at).toLocaleDateString('zh-TW');

async function renderAcct() {
  const body = $('#acctBody');
  const uid = SESSION.user.id;
  body.innerHTML = '<div class="acct-empty">載入中…</div>';

  if (acctTab === 'listings') {
    const { data, error } = await sb.from(CFG.TABLE).select('*').eq('seller_id', uid).order('created_at', { ascending: false });
    if (error) { body.innerHTML = `<div class="acct-empty">讀取失敗：${escapeHtml(error.message)}</div>`; return; }
    if (!data.length) { body.innerHTML = '<div class="acct-empty">你還沒有刊登任何商品。<br>點右上角「刊登」上架第一件吧！</div>'; return; }
    body.innerHTML = `<div class="acct-list">${data.map(r => {
      const p = normalize(r);
      const thumb = p.image ? `style="background-image:url('${escapeHtml(p.image)}')"` : '';
      return `<div class="acct-row">
        <div class="thumb" ${thumb}>${p.image ? '' : p.emoji}</div>
        <div class="info">
          <h4>${escapeHtml(p.title)}</h4>
          <div class="sub">${escapeHtml(CAT_NAME[p.cat])} · ${money(p.price)} · ${r.for_sale ? '<span class="pill on">販售中</span>' : '<span class="pill off">已下架</span>'}</div>
        </div>
        <div class="acts">
          <button class="mini-btn" data-edit="${p.id}">編輯</button>
          <button class="mini-btn" data-toggle="${p.id}" data-cur="${r.for_sale}">${r.for_sale ? '下架' : '重新上架'}</button>
          <button class="mini-btn danger" data-del="${p.id}">刪除</button>
        </div>
      </div>`;
    }).join('')}</div>`;
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditProduct(b.dataset.edit));
    body.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => toggleForSale(b.dataset.toggle, b.dataset.cur === 'true'));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteProduct(b.dataset.del));
    return;
  }

  // bought / sold → doll_orders
  const col = acctTab === 'bought' ? 'buyer_id' : 'seller_id';
  const { data, error } = await sb.from('doll_orders').select('*').eq(col, uid).order('created_at', { ascending: false });
  if (error) { body.innerHTML = `<div class="acct-empty">讀取失敗：${escapeHtml(error.message)}</div>`; return; }
  if (!data.length) {
    body.innerHTML = `<div class="acct-empty">${acctTab === 'bought' ? '你還沒有購買紀錄。' : '你還沒有賣出任何商品。'}</div>`; return;
  }
  body.innerHTML = `<div class="acct-list">${data.map(o => {
    const line = acctTab === 'bought'
      ? `付款 ${money(o.amount)} · ${orderDate(o)}`
      : `買家 ${escapeHtml(o.buyer_email || '—')} · 實收 <b>${money(o.seller_payout)}</b> · ${orderDate(o)}`;
    return `<div class="acct-row">
      <div class="thumb">${acctTab === 'bought' ? '🛍️' : '📦'}</div>
      <div class="info">
        <h4>${escapeHtml(o.product_title)}</h4>
        <div class="sub">${line}</div>
      </div>
      <div class="acts">${statusPill(o.status)}</div>
    </div>`;
  }).join('')}</div>`;
}

async function toggleForSale(id, cur) {
  const { error } = await sb.from(CFG.TABLE).update({ for_sale: !cur }).eq('id', id);
  if (error) { toast('操作失敗：' + error.message); return; }
  await loadProducts(); renderZones(); renderMarket(); renderAcct();
  toast(cur ? '已下架' : '已重新上架');
}
async function deleteProduct(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!window.confirm(`確定要刪除「${p ? p.title : '這件商品'}」嗎？此動作無法復原。`)) return;
  const { error } = await sb.from(CFG.TABLE).delete().eq('id', id);
  if (error) { toast('刪除失敗：' + error.message); return; }
  await loadProducts(); renderZones(); renderMarket(); renderAcct();
  toast('已刪除商品');
}

/* ---------- 費用試算區 ---------- */
function renderCalc() {
  const price = +$('#calcPrice').value || 0;
  const f = feeBreakdown(price);
  $('#calcOut').innerHTML = `
    <div class="r"><span>刊登費</span><span class="g">免費</span></div>
    <div class="r"><span>買家支付</span><span>${money(f.price)}</span></div>
    <div class="r"><span>成交手續費（5%）</span><span class="d">− ${money(f.commission)}</span></div>
    <div class="r"><span>金流費（2.5% + NT$5）</span><span class="d">− ${money(f.payment)}</span></div>
    <div class="r total"><span>賣家實收</span><span class="g">${money(f.payout)}</span></div>`;
}
$('#calcPrice').oninput = renderCalc;

/* ---------- 商城分類 chip ---------- */
$('#mktBar').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  currentCat = chip.dataset.cat;
  $$('#mktBar .chip').forEach(c => c.classList.toggle('active', c === chip));
  renderMarket();
});

/* ---------- 導覽列漢堡 ---------- */
$('#navToggle').onclick = () => $('#navLinks').classList.toggle('open');
$$('#navLinks a').forEach(a => a.onclick = () => $('#navLinks').classList.remove('open'));

/* ---------- 費率文字（若之後改費率，介面自動同步） ---------- */
$('#feeCommTxt').textContent = `售價 × ${(FEES.commissionRate*100)}%`;
$('#feePayTxt').textContent = `售價 × ${(FEES.paymentRate*100)}% ＋ NT$${FEES.paymentFixed}`;

/* ---------- 登入狀態變化時同步 UI ---------- */
sb.auth.onAuthStateChange((_e, session) => { SESSION = session; renderAccount(); });

/* ---------- 啟動 ---------- */
(async function init() {
  renderCalc();
  await refreshSession();
  renderAccount();
  await loadProducts();
  renderZones();
  renderMarket();
  await loadCampaigns();
  renderCampaigns();
  checkPaidReturn();
})();
