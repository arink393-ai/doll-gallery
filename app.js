/* ==========================================================================
   娃娃收藏館 · Marketplace 前端邏輯（展示版）
   資料層目前用 localStorage，設計成可抽換 —— 之後把 Store 換成 Supabase 即可。
   金流：目前只做「費用試算 + 結帳明細」，實際收款需串接台灣金流商後啟用。
   ========================================================================== */

/* ---------- 費率設定（預設值，之後可調） ---------- */
const FEES = {
  listing: 0,          // 刊登費：免費
  commissionRate: 0.05, // 成交手續費 5%
  paymentRate: 0.025,   // 金流費率 2.5%
  paymentFixed: 5,      // 金流固定費 NT$5
};

/* ---------- 資料層（可抽換：改成 Supabase 時只需換這一層） ---------- */
const Store = {
  _get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  users()      { return this._get('dg_users', []); },
  saveUsers(u) { this._set('dg_users', u); },
  products()   { return this._get('dg_products', null) || seedProducts(); },
  saveProducts(p){ this._set('dg_products', p); },
  session()    { return this._get('dg_session', null); },
  setSession(id){ id ? this._set('dg_session', id) : localStorage.removeItem('dg_session'); },
};

/* ---------- 種子資料（展示用；館藏標為非賣，商城有可買商品） ---------- */
function seedProducts() {
  const seed = [
    // 芭比 館藏（展示，非賣）
    { id:'s1', cat:'barbie', title:'復刻經典芭比', meta:'1959 復刻 · 條紋泳裝', desc:'向初代芭比致敬的復刻款，黑白條紋泳裝與招牌馬尾。', tag:'經典系列', emoji:'💃', price:0, forSale:false, sellerName:'館藏' },
    { id:'s2', cat:'barbie', title:'晚宴禮服芭比', meta:'Collector · 亮片長裙', desc:'華麗亮片禮服搭配長手套，收藏家系列的代表造型。', tag:'禮服系列', emoji:'👛', price:2800, forSale:true, sellerName:'Eugenie' },
    { id:'s3', cat:'barbie', title:'聯名限量芭比', meta:'Limited · 限量編號', desc:'品牌聯名的限量款式，附收藏證與專屬包裝。', tag:'聯名款', emoji:'🎀', price:4500, forSale:true, sellerName:'Eugenie' },
    // 小布 館藏
    { id:'s4', cat:'blythe', title:'原裝小布', meta:'Neo Blythe · 原廠妝', desc:'保留原廠妝容與眼片的原裝小布，變色拉繩完好。', tag:'原裝款', emoji:'🧸', price:0, forSale:false, sellerName:'館藏' },
    { id:'s5', cat:'blythe', title:'訂製改娃小布', meta:'Custom · 手繪妝', desc:'手繪重妝與植髮的訂製款，五官更柔和、獨一無二。', tag:'改娃款', emoji:'🌸', price:6800, forSale:true, sellerName:'Momo' },
    { id:'s6', cat:'blythe', title:'Petite 迷你小布', meta:'Petite · 掌心尺寸', desc:'掌心大小的迷你版本，適合擺飾與外出拍照。', tag:'迷你款', emoji:'☕', price:1200, forSale:true, sellerName:'Momo' },
    // BJD 專區（新）
    { id:'s7', cat:'bjd', title:'1/3 SD 訂製娃', meta:'1/3 · 全套妝體', desc:'1/3 尺寸球型關節娃，含頭雕、素體、開眉眼與訂製妝容。', tag:'1/3 SD', emoji:'🎎', price:12800, forSale:true, sellerName:'Rin' },
    { id:'s8', cat:'bjd', title:'1/4 MSD 少女頭', meta:'1/4 · 單頭', desc:'MSD 尺寸單頭雕，樹脂膚色接近粉膚，附原廠證卡。', tag:'1/4 MSD', emoji:'👤', price:5600, forSale:true, sellerName:'Rin' },
    { id:'s9', cat:'bjd', title:'1/6 YOSD 全套', meta:'1/6 · 素體+服裝', desc:'YOSD 小尺寸，附素體、假髮、眼珠與一套服裝，新手友善。', tag:'1/6 YOSD', emoji:'🧚', price:3900, forSale:true, sellerName:'Sora' },
    // 配件
    { id:'s10', cat:'accessory', title:'手作娃用洋裝（3件組）', meta:'配件 · 適用 1/6', desc:'手工縫製洋裝三件組，適用小布與 1/6 BJD。', tag:'服裝', emoji:'👗', price:850, forSale:true, sellerName:'Sora' },
  ];
  Store.saveProducts(seed);
  return seed;
}

/* ---------- 小工具 ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const money = n => 'NT$' + Math.round(n).toLocaleString('en-US');
const CAT_CLASS = { barbie:'pink', blythe:'blue', bjd:'bjd', accessory:'bjd' };
const CAT_NAME  = { barbie:'芭比', blythe:'小布', bjd:'BJD', accessory:'配件/服裝' };

function feeBreakdown(price) {
  const commission = price * FEES.commissionRate;
  const payment = price * FEES.paymentRate + FEES.paymentFixed;
  const payout = price - commission - payment;
  return { price, commission, payment, payout };
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- Auth ---------- */
const Auth = {
  current() {
    const id = Store.session();
    return id ? Store.users().find(u => u.id === id) || null : null;
  },
  register(name, email, pass) {
    const users = Store.users();
    if (users.some(u => u.email === email)) throw new Error('這個 Email 已經註冊過了。');
    const user = { id: 'u' + Date.now(), name: name || email.split('@')[0], email, pass };
    users.push(user); Store.saveUsers(users); Store.setSession(user.id);
    return user;
  },
  login(email, pass) {
    const user = Store.users().find(u => u.email === email);
    if (!user || user.pass !== pass) throw new Error('Email 或密碼錯誤。');
    Store.setSession(user.id); return user;
  },
  logout() { Store.setSession(null); },
};

/* ---------- 渲染：導覽列帳號區 ---------- */
function renderAccount() {
  const el = $('#navAccount'); const u = Auth.current();
  if (u) {
    el.innerHTML = `<span class="who">👤 ${escapeHtml(u.name)}</span>
      <button class="btn btn-dark btn-sm" id="accSell">刊登</button>
      <button class="link-btn" id="accLogout">登出</button>`;
    $('#accSell').onclick = openSell;
    $('#accLogout').onclick = () => { Auth.logout(); renderAccount(); toast('已登出'); };
  } else {
    el.innerHTML = `<button class="link-btn" id="accLogin">登入</button>
      <button class="btn btn-dark btn-sm" id="accReg">註冊</button>`;
    $('#accLogin').onclick = () => openAuth('login');
    $('#accReg').onclick = () => openAuth('register');
  }
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- 渲染：專區卡片 ---------- */
function cardHtml(p) {
  const cls = CAT_CLASS[p.cat] || 'bjd';
  const bg = p.image ? `style="background-image:url('${p.image}')"` : '';
  const priceTag = p.forSale ? `<span class="price-tag">${money(p.price)}</span>` : '';
  const emoji = p.image ? '' : (p.emoji || '🎎');
  const action = p.forSale
    ? `<button class="btn btn-dark btn-sm" data-buy="${p.id}">查看 / 購買</button>`
    : `<span class="seller">館藏展示</span>`;
  return `<article class="doll ${cls}">
    <div class="photo" ${bg}>${emoji}<span class="tag">${escapeHtml(p.tag || CAT_NAME[p.cat])}</span>${priceTag}</div>
    <div class="body">
      <h4>${escapeHtml(p.title)}</h4>
      <p class="meta">${escapeHtml(p.meta || '')}</p>
      <p class="desc">${escapeHtml(p.desc || '')}</p>
      <div class="row">
        <span class="seller">賣家：${escapeHtml(p.sellerName || '—')}</span>
        ${action}
      </div>
    </div>
  </article>`;
}

function renderZones() {
  const all = Store.products();
  ['barbie','blythe','bjd'].forEach(cat => {
    const grid = $('#grid-' + cat);
    grid.innerHTML = all.filter(p => p.cat === cat).map(cardHtml).join('');
  });
  bindBuyButtons();
}

let currentCat = 'all';
function renderMarket() {
  const all = Store.products().filter(p => p.forSale);
  const list = currentCat === 'all' ? all : all.filter(p => p.cat === currentCat);
  const grid = $('#grid-market'), empty = $('#mktEmpty');
  grid.innerHTML = list.map(cardHtml).join('');
  empty.hidden = list.length > 0;
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
$('#authSubmit').onclick = () => {
  const name = $('#authName').value.trim();
  const email = $('#authEmail').value.trim();
  const pass = $('#authPass').value;
  const err = $('#authErr'); err.textContent = '';
  if (!email || !pass) { err.textContent = '請輸入 Email 與密碼。'; return; }
  if (pass.length < 6) { err.textContent = '密碼至少 6 碼。'; return; }
  try {
    if (authMode === 'register') Auth.register(name, email, pass);
    else Auth.login(email, pass);
    closeModal($('#authModal')); renderAccount();
    toast(authMode === 'register' ? '註冊成功，已登入' : '登入成功');
    if (pendingAction) { const a = pendingAction; pendingAction = null; a(); }
  } catch (e) { err.textContent = e.message; }
};

/* 需要登入才能做的動作 */
let pendingAction = null;
function requireLogin(action) {
  if (Auth.current()) { action(); }
  else { pendingAction = action; openAuth('login'); toast('請先登入或註冊'); }
}

/* ---------- Sell / Upload Modal ---------- */
let uploadedImage = null;
function openSell() {
  requireLogin(() => {
    uploadedImage = null;
    $('#pTitle').value=''; $('#pPrice').value=''; $('#pDesc').value='';
    $('#pCat').value='bjd'; $('#pPreview').innerHTML=''; $('#pDrop').classList.remove('has');
    $('#pDrop').firstChild && ($('#sellErr').textContent='');
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
  const reader = new FileReader();
  reader.onload = () => {
    uploadedImage = reader.result;
    $('#pPreview').innerHTML = `<img src="${uploadedImage}" alt="預覽">`;
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
$('#sellSubmit').onclick = () => {
  const title = $('#pTitle').value.trim();
  const cat = $('#pCat').value;
  const price = +$('#pPrice').value || 0;
  const desc = $('#pDesc').value.trim();
  const err = $('#sellErr'); err.textContent='';
  if (!title) { err.textContent='請輸入商品名稱。'; return; }
  if (price <= 0) { err.textContent='請輸入有效售價。'; return; }
  const u = Auth.current();
  const emojiByCat = { barbie:'👗', blythe:'🌸', bjd:'🎎', accessory:'👜' };
  const p = {
    id: 'p' + Date.now(), cat, title, price, desc,
    meta: CAT_NAME[cat] + ' · 會員刊登', tag: CAT_NAME[cat],
    emoji: emojiByCat[cat] || '🎎', image: uploadedImage,
    forSale: true, sellerName: u.name, sellerId: u.id, createdAt: Date.now(),
  };
  const products = Store.products(); products.unshift(p); Store.saveProducts(products);
  closeModal($('#sellModal')); renderZones(); renderMarket();
  toast('刊登成功！商品已上架商城');
  document.getElementById('market').scrollIntoView({ behavior:'smooth' });
};

/* ---------- Detail / Checkout Modal ---------- */
function openDetail(id) {
  const p = Store.products().find(x => x.id === id); if (!p) return;
  const cls = CAT_CLASS[p.cat] || 'bjd';
  const bg = p.image ? `style="background-image:url('${p.image}')"` : `class="detail-photo ${cls}"`;
  const f = feeBreakdown(p.price);
  $('#detailBody').innerHTML = `
    <div class="detail-photo ${p.image?'':cls}" ${p.image?`style="background-image:url('${p.image}')"`:''}>${p.image?'':(p.emoji||'🎎')}</div>
    <h3>${escapeHtml(p.title)}</h3>
    <p class="sub">${escapeHtml(CAT_NAME[p.cat])} · 賣家 ${escapeHtml(p.sellerName)}</p>
    <p style="color:#5c4a4a;font-size:.92rem">${escapeHtml(p.desc||'')}</p>
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
    <p class="hint" style="margin-top:12px;font-size:.78rem">※ 展示版：此處僅顯示金流費用明細，實際刷卡／付款需串接台灣金流商後啟用。</p>`;
  openModal('detailModal');
  $('#detailModal [data-close]').onclick = () => closeModal($('#detailModal'));
  $('#buyNow').onclick = () => requireLogin(() => {
    const buyer = Auth.current();
    if (buyer.name === p.sellerName) { toast('這是你自己刊登的商品'); return; }
    closeModal($('#detailModal'));
    toast(`已建立訂單（展示）：${p.title}`);
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

/* ---------- 啟動 ---------- */
renderAccount();
renderZones();
renderMarket();
renderCalc();
