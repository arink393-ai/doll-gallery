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
    el.innerHTML = `<span class="who">👤 ${escapeHtml(userName(u))}</span>
      <button class="btn btn-dark btn-sm" id="accSell">刊登</button>
      <button class="link-btn" id="accLogout">登出</button>`;
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
function openSell() {
  requireLogin(() => {
    uploadedFile = null;
    $('#pTitle').value=''; $('#pPrice').value=''; $('#pDesc').value='';
    $('#pCat').value='bjd'; $('#pPreview').innerHTML=''; $('#pDrop').classList.remove('has');
    $('#sellErr').textContent='';
    updateSellFeeHint();
    openModal('sellModal');
  });
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
  const btn = $('#sellSubmit'); btn.disabled = true; const label = btn.textContent; btn.textContent = '上架中…';
  try {
    let image_url = null;
    if (uploadedFile) {
      const ext = (uploadedFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from(CFG.BUCKET).upload(path, uploadedFile, { cacheControl:'3600', upsert:false });
      if (upErr) throw new Error('圖片上傳失敗：' + upErr.message);
      image_url = sb.storage.from(CFG.BUCKET).getPublicUrl(path).data.publicUrl;
    }
    const { error } = await sb.from(CFG.TABLE).insert({
      seller_id: user.id, seller_name: userName(user),
      cat, title, price, descr: desc, image_url, for_sale: true,
    });
    if (error) throw new Error('刊登失敗：' + error.message);
    await loadProducts(); renderZones(); renderMarket();
    closeModal($('#sellModal'));
    toast('刊登成功！商品已上架商城');
    document.getElementById('market').scrollIntoView({ behavior:'smooth' });
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
    <p class="hint" style="margin-top:12px;font-size:.78rem">※ 金流尚未串接：此處僅顯示費用明細，實際付款需完成台灣金流商註冊後啟用。</p>`;
  openModal('detailModal');
  $('#detailModal [data-close]').onclick = () => closeModal($('#detailModal'));
  $('#buyNow').onclick = () => requireLogin(() => {
    if (SESSION.user.id === p.sellerId) { toast('這是你自己刊登的商品'); return; }
    closeModal($('#detailModal'));
    toast(`已建立訂單（金流待接）：${p.title}`);
  });
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
})();
