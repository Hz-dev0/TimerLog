import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc,
  onSnapshot, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAKpdKG7Z9VftOewWAF8icxJDlyt-za8R4",
  authDomain:        "counter-e1ce2.firebaseapp.com",
  projectId:         "counter-e1ce2",
  storageBucket:     "counter-e1ce2.firebasestorage.app",
  messagingSenderId: "1079520607651",
  appId:             "1:1079520607651:web:d75a7447f1c6de3e5e2e16"
};

const firebaseApp = initializeApp(firebaseConfig);
const db   = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// ── Constants ────────────────────────────────────────────────────────────────
const MIN_OPTIONS = [15, 20, 25, 30, 45, 60, 90];
const DAY_NAMES   = ['日','一','二','三','四','五','六'];

// ── State ─────────────────────────────────────────────────────────────────────
let uid         = null;
let weekOffset  = 0;
let editKey     = null;
let editId      = null;
let unsub       = null;
let localData   = {};
let selectedMin = null;
// pendingDelete: { id, timer }
let pendingDelete = {};

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function dayKey(d) { return d.toISOString().slice(0, 10); }

function today() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

function weekDays(wOffset) {
  const base = today();
  const dow  = base.getDay() === 0 ? 6 : base.getDay() - 1;
  const mon  = new Date(base);
  mon.setDate(base.getDate() - dow + wOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return d;
  });
}

function fmt(d) {
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

function setSyncDot(state) {
  const dot = document.querySelector('.sync-dot');
  if (dot) dot.className = 'sync-dot ' + state;
}

// ── Firestore ─────────────────────────────────────────────────────────────────
function colRef() { return collection(db, 'users', uid, 'events'); }

function subscribeWeek(days) {
  if (unsub) unsub();
  const keys = days.map(dayKey);
  const q = query(colRef(), where('date', 'in', keys));
  unsub = onSnapshot(q, snap => {
    keys.forEach(k => { localData[k] = []; });
    snap.forEach(d => {
      const data = d.data();
      if (!localData[data.date]) localData[data.date] = [];
      // 跳過仍有暫時 id 的樂觀項目（前綴 opt_），避免重複
      if (!localData[data.date].find(e => e.id === d.id)) {
        localData[data.date].push({
          id:   d.id,
          name: data.name || '',
          min:  data.min  || 0,
          ts:   data.ts?.toMillis?.() || 0
        });
      }
    });
    // 移除已被 Firestore 確認的樂觀項目（ts 為 0 代表尚未確認）
    // 同時清掉 opt_ 前綴的孤兒（理論上不該有，防禦用）
    keys.forEach(k => {
      localData[k].sort((a, b) => a.ts - b.ts);
    });
    render();
  }, err => {
    showToast('讀取失敗：' + err.code);
  });
}

async function addEvent(name, min) {
  // 樂觀更新：先塞暫時項目立即渲染
  const tempId  = 'opt_' + Date.now();
  const todayK  = dayKey(today());
  if (!localData[todayK]) localData[todayK] = [];
  localData[todayK].push({ id: tempId, name, min, ts: Date.now() });
  render();

  setSyncDot('syncing');
  try {
    const ref = await addDoc(colRef(), { date: todayK, name, min, ts: serverTimestamp() });
    // 以真實 id 替換暫時項目
    const arr = localData[todayK];
    const idx = arr.findIndex(e => e.id === tempId);
    if (idx !== -1) arr[idx].id = ref.id;
    setSyncDot('synced');
    render();
  } catch(e) {
    // 失敗：移除樂觀項目
    localData[todayK] = localData[todayK].filter(e => e.id !== tempId);
    showToast('儲存失敗：' + e.code);
    setSyncDot('');
    render();
  }
}

async function saveEvent(id, name, min) {
  // 樂觀更新
  for (const key of Object.keys(localData)) {
    const ev = localData[key].find(e => e.id === id);
    if (ev) { ev.name = name; ev.min = min; break; }
  }
  editKey = null; editId = null;
  render();

  setSyncDot('syncing');
  try {
    await updateDoc(doc(db, 'users', uid, 'events', id), { name, min });
    setSyncDot('synced');
  } catch(e) {
    showToast('更新失敗：' + e.code);
    setSyncDot('');
  }
}

function requestDelete(id) {
  // 兩段式刪除：第一次點先進入 pending，3 秒後自動取消；再點才真正刪除
  if (pendingDelete[id]) {
    // 已在 pending → 確認刪除
    clearTimeout(pendingDelete[id].timer);
    delete pendingDelete[id];
    _doDelete(id);
  } else {
    // 第一次 → 進入 pending，UI 會顯示紅色
    const timer = setTimeout(() => {
      delete pendingDelete[id];
      renderRow(id); // 3 秒後恢復原色
    }, 3000);
    pendingDelete[id] = { timer };
    renderRow(id);   // 立即讓那筆 row 的刪除鈕變紅
  }
}

async function _doDelete(id) {
  // 樂觀移除
  for (const key of Object.keys(localData)) {
    localData[key] = localData[key].filter(e => e.id !== id);
  }
  if (editId === id) { editKey = null; editId = null; }
  render();

  setSyncDot('syncing');
  try {
    await deleteDoc(doc(db, 'users', uid, 'events', id));
    setSyncDot('synced');
  } catch(e) {
    showToast('刪除失敗：' + e.code);
    setSyncDot('');
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────
// 只更新單一 row 的刪除鈕樣式（pending 狀態切換），不重繪整個 DOM
function renderRow(id) {
  const btn = document.querySelector(`.ev-del[data-id="${id}"]`);
  if (!btn) return;
  btn.classList.toggle('confirm', !!pendingDelete[id]);
}

// buildRow：建立一筆事件的 DOM，供 render / patchDay 共用
function buildRow(ev, key) {
  const isEd = editKey === key && editId === ev.id;
  const row = document.createElement('div');
  row.className = 'ev-row' + (isEd ? ' editing' : '');
  row.dataset.id = ev.id;

  const nm = document.createElement('div');
  nm.className = 'ev-name' + (ev.name ? '' : ' ph');
  nm.textContent = ev.name || '未命名…';

  const mn = document.createElement('div');
  mn.className = 'ev-min';
  mn.textContent = ev.min ? ev.min + ' 分' : '—';

  const del = document.createElement('button');
  del.className = 'ev-del' + (pendingDelete[ev.id] ? ' confirm' : '');
  del.textContent = '✕';
  del.dataset.id = ev.id;
  del.setAttribute('aria-label', '刪除');
  del.addEventListener('click', e => {
    e.stopPropagation();
    requestDelete(ev.id);
  });

  row.append(nm, mn, del);

  if (isEd) {
    const ie = document.createElement('div');
    ie.className = 'inline-edit';
    const ni = document.createElement('input');
    ni.type = 'text'; ni.value = ev.name; ni.placeholder = '事件名稱';
    const ms = document.createElement('select');
    ms.style.cssText = 'font-family:var(--font-mono);font-size:13px;padding:5px 6px;border-radius:6px;border:1px solid var(--border-mid);background:var(--bg);color:var(--text);outline:none;';
    [0, ...MIN_OPTIONS].forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v ? v + ' 分' : '—';
      if (v === ev.min) o.selected = true;
      ms.appendChild(o);
    });
    const ok = document.createElement('button');
    ok.textContent = '儲存';
    ok.addEventListener('click', e => {
      e.stopPropagation();
      saveEvent(ev.id, ni.value.trim(), parseInt(ms.value) || ev.min || 0);
    });
    ni.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); });
    ie.append(ni, ms, ok);
    row.appendChild(ie);
    setTimeout(() => ni.focus(), 50);
  }

  row.addEventListener('click', () => {
    editKey === key && editId === ev.id
      ? (editKey = null, editId = null)
      : (editKey = key, editId = ev.id);
    patchDay(key);
  });

  return row;
}

// patchDay：只重繪某一天的 tl-wrap，header 數字也一起更新
function patchDay(key) {
  const wrap = document.querySelector(`.tl-wrap[data-key="${key}"]`);
  if (!wrap) { render(); return; }

  // 更新 header total
  const evs   = localData[key] || [];
  const totalM = evs.reduce((s, e) => s + (e.min || 0), 0);
  const tot = wrap.closest('.day-block')?.querySelector('.day-total');
  if (tot) tot.textContent = totalM ? totalM + ' 分' : '';

  // diff rows
  const existing = [...wrap.querySelectorAll('.ev-row')];
  const existingIds = existing.map(r => r.dataset.id);
  const newIds      = evs.map(e => e.id);

  // 移除消失的 row
  existing.forEach(r => { if (!newIds.includes(r.dataset.id)) r.remove(); });

  // 插入 / 更新
  evs.forEach((ev, i) => {
    const cur = wrap.querySelector(`.ev-row[data-id="${ev.id}"]`);
    const newRow = buildRow(ev, key);
    if (!cur) {
      // 新增：插入到正確位置
      const after = wrap.querySelectorAll('.ev-row')[i];
      wrap.insertBefore(newRow, after || null);
    } else {
      // 比對是否需要換掉（editing 狀態改變、或內容改變）
      const needsReplace =
        cur.classList.contains('editing') !== newRow.classList.contains('editing') ||
        cur.querySelector('.ev-name')?.textContent !== newRow.querySelector('.ev-name')?.textContent ||
        cur.querySelector('.ev-min')?.textContent  !== newRow.querySelector('.ev-min')?.textContent ||
        cur.querySelector('.ev-del')?.classList.contains('confirm') !== newRow.querySelector('.ev-del')?.classList.contains('confirm');
      if (needsReplace) cur.replaceWith(newRow);
    }
  });
}

// ── Full render（只在週切換 / 首次載入時跑）────────────────────────────────────
function render() {
  const days = weekDays(weekOffset);
  $('weekRange').innerHTML = fmt(days[0]) + ' – ' + fmt(days[6]) +
    ' <span class="sync-dot"></span>';
  $('prevWeek').disabled = weekOffset <= -12;
  $('nextWeek').disabled = weekOffset >= 0;
  $('addBar').style.display = weekOffset === 0 ? 'flex' : 'none';

  const body     = $('weekBody');
  const todayKey = dayKey(today());

  // 已存在的 day-block map
  const existingBlocks = {};
  body.querySelectorAll('.day-block[data-key]').forEach(b => {
    existingBlocks[b.dataset.key] = b;
  });

  const dayKeys = days.filter(d => d <= today()).map(dayKey);

  // 移除不在本週的 block
  Object.keys(existingBlocks).forEach(k => {
    if (!dayKeys.includes(k)) existingBlocks[k].remove();
  });

  days.forEach((day, di) => {
    if (day > today()) return;
    const key     = dayKey(day);
    const evs     = localData[key] || [];
    const isToday = key === todayKey;
    const totalM  = evs.reduce((s, e) => s + (e.min || 0), 0);

    if (existingBlocks[key]) {
      // block 已存在 → patch
      patchDay(key);
      return;
    }

    // 建立新 block
    const block = document.createElement('div');
    block.className = 'day-block' + (isToday ? ' today-block' : '');
    block.dataset.key = key;

    const hdr = document.createElement('div');
    hdr.className = 'day-header';
    const lbl = document.createElement('span');
    lbl.className = 'day-label' + (isToday ? ' today' : '');
    lbl.textContent = isToday ? '今天' : '週' + DAY_NAMES[day.getDay()];
    const dt = document.createElement('span');
    dt.className = 'day-date';
    dt.textContent = fmt(day);
    const tot = document.createElement('span');
    tot.className = 'day-total';
    tot.textContent = totalM ? totalM + ' 分' : '';
    hdr.append(lbl, dt, tot);
    block.appendChild(hdr);

    const tl = document.createElement('div');
    tl.className = 'tl-wrap';
    tl.dataset.key = key;
    evs.forEach(ev => tl.appendChild(buildRow(ev, key)));
    block.appendChild(tl);

    if (di < 6) {
      const hr = document.createElement('hr');
      hr.className = 'day-divider';
      block.appendChild(hr);
    }

    // 插入到正確順序位置
    const dayIndex = dayKeys.indexOf(key);
    const blocks = [...body.querySelectorAll('.day-block[data-key]')];
    const insertBefore = blocks.find(b => dayKeys.indexOf(b.dataset.key) > dayIndex);
    body.insertBefore(block, insertBefore || null);
  });
}

// ── Minute picker ─────────────────────────────────────────────────────────────
const minTrigger = $('minTrigger');
const minDrawer  = $('minDrawer');
const minScroll  = $('minScroll');

MIN_OPTIONS.forEach(m => {
  const opt = document.createElement('div');
  opt.className = 'min-opt';
  opt.textContent = m + ' 分';
  opt.dataset.val = m;
  opt.addEventListener('click', () => {
    selectedMin = m;
    minTrigger.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = m + ' 分';
    minTrigger.appendChild(span);
    document.querySelectorAll('.min-opt').forEach(o =>
      o.classList.toggle('selected', +o.dataset.val === m));
    closeDrawer();
  });
  minScroll.appendChild(opt);
});

function openDrawer()  { minDrawer.classList.add('open');    minTrigger.classList.add('active'); }
function closeDrawer() { minDrawer.classList.remove('open'); minTrigger.classList.remove('active'); }

minTrigger.addEventListener('click', e => {
  e.stopPropagation();
  minDrawer.classList.contains('open') ? closeDrawer() : openDrawer();
});
document.addEventListener('click', () => closeDrawer());
minDrawer.addEventListener('click', e => e.stopPropagation());

// ── Controls ──────────────────────────────────────────────────────────────────
$('prevWeek').addEventListener('click', () => {
  weekOffset--; editKey = null; editId = null;
  subscribeWeek(weekDays(weekOffset));
});
$('nextWeek').addEventListener('click', () => {
  weekOffset++; editKey = null; editId = null;
  subscribeWeek(weekDays(weekOffset));
});
$('addBtn').addEventListener('click', () => {
  const name = $('nameIn').value.trim();
  const min  = selectedMin || 0;
  if (!name && !min) return;
  addEvent(name, min);
  $('nameIn').value = '';
  selectedMin = null;
  minTrigger.innerHTML = '<span class="placeholder">分</span>';
  document.querySelectorAll('.min-opt').forEach(o => o.classList.remove('selected'));
  focusInput();
});
$('nameIn').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('addBtn').click();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
const provider = new GoogleAuthProvider();

function renderLogin() {
  $('app').style.display = 'none';
  let screen = $('loginScreen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'loginScreen';

    const inner = document.createElement('div');
    inner.className = 'login-inner';

    const title = document.createElement('h1');
    title.className = 'login-title';
    title.textContent = '時間紀錄';

    const sub = document.createElement('p');
    sub.className = 'login-sub';
    sub.textContent = '記錄每一段時間的投入';

    const btn = document.createElement('button');
    btn.className = 'google-btn';
    btn.setAttribute('aria-label', '用 Google 登入');
    btn.innerHTML = `
      <svg class="google-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="22" height="22">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        <path fill="none" d="M0 0h48v48H0z"/>
      </svg>
      <span>用 Google 登入</span>
    `;
    btn.addEventListener('click', () =>
      signInWithPopup(auth, provider).catch(e => showToast('登入失敗：' + e.code))
    );

    inner.append(title, sub, btn);
    screen.appendChild(inner);
    document.body.appendChild(screen);
  }
  screen.style.display = 'flex';
}

// ── Auto-focus ────────────────────────────────────────────────────────────────
function focusInput() {
  const input = $('nameIn');
  if (!input) return;
  requestAnimationFrame(() => { input.focus({ preventScroll: true }); });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('addBar')?.style.display !== 'none') {
    focusInput();
  }
});

function renderUserBar(user) {
  let bar = $('userBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'userBar';
    bar.className = 'user-bar';

    const uidWrap = document.createElement('div');
    uidWrap.className = 'uid-wrap';

    const uidLabel = document.createElement('span');
    uidLabel.className = 'uid-label';
    uidLabel.textContent = 'UID';

    const uidValue = document.createElement('span');
    uidValue.className = 'uid-value';
    uidValue.id = 'uidValue';
    uidValue.title = '點擊複製';
    uidValue.addEventListener('click', () => {
      navigator.clipboard?.writeText(user.uid).then(() => showToast('UID 已複製'));
    });

    uidWrap.append(uidLabel, uidValue);

    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'signout-btn';
    signOutBtn.textContent = '登出';
    signOutBtn.addEventListener('click', () => {
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js')
        .then(({ signOut }) => signOut(auth));
    });

    bar.append(uidWrap, signOutBtn);
    $('app').insertBefore(bar, $('app').firstChild);
  }
  $('uidValue').textContent = user.uid;
}

onAuthStateChanged(auth, user => {
  if (user) {
    uid = user.uid;
    const s = $('loginScreen');
    if (s) s.style.display = 'none';
    $('app').style.display = 'flex';
    renderUserBar(user);
    subscribeWeek(weekDays(weekOffset));
    focusInput();
  } else {
    uid = null;
    const bar = $('userBar');
    if (bar) bar.remove();
    renderLogin();
  }
});
