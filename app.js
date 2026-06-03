import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc,
  onSnapshot, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
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
  // Query only by date, sort client-side to avoid needing composite index
  const q = query(colRef(), where('date', 'in', keys));
  unsub = onSnapshot(q, snap => {
    keys.forEach(k => { localData[k] = []; });
    snap.forEach(d => {
      const data = d.data();
      if (!localData[data.date]) localData[data.date] = [];
      localData[data.date].push({
        id:  d.id,
        name: data.name || '',
        min:  data.min  || 0,
        ts:   data.ts?.toMillis?.() || 0
      });
    });
    // Sort each day by timestamp client-side
    keys.forEach(k => {
      localData[k].sort((a, b) => a.ts - b.ts);
    });
    render();
  }, err => {
    showToast('讀取失敗：' + err.code);
  });
}

async function addEvent(name, min) {
  setSyncDot('syncing');
  try {
    await addDoc(colRef(), { date: dayKey(today()), name, min, ts: serverTimestamp() });
    setSyncDot('synced');
  } catch(e) {
    showToast('儲存失敗：' + e.code);
    setSyncDot('');
  }
}

async function saveEvent(id, name, min) {
  setSyncDot('syncing');
  try {
    await updateDoc(doc(db, 'users', uid, 'events', id), { name, min });
    setSyncDot('synced');
  } catch(e) {
    showToast('更新失敗：' + e.code);
    setSyncDot('');
  }
}

async function deleteEvent(id) {
  setSyncDot('syncing');
  try {
    await deleteDoc(doc(db, 'users', uid, 'events', id));
    setSyncDot('synced');
  } catch(e) {
    showToast('刪除失敗：' + e.code);
    setSyncDot('');
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const days = weekDays(weekOffset);
  $('weekRange').innerHTML = fmt(days[0]) + ' – ' + fmt(days[6]) +
    ' <span class="sync-dot"></span>';
  $('prevWeek').disabled = weekOffset <= -12;
  $('nextWeek').disabled = weekOffset >= 0;
  $('addBar').style.display = weekOffset === 0 ? 'flex' : 'none';

  const body = $('weekBody');
  body.innerHTML = '';
  const todayKey = dayKey(today());

  days.forEach((day, di) => {
    if (day > today()) return;
    const key    = dayKey(day);
    const evs    = localData[key] || [];
    const isToday = key === todayKey;
    const totalM  = evs.reduce((s, e) => s + (e.min || 0), 0);

    const block = document.createElement('div');
    block.className = 'day-block';

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

    if (evs.length === 0) {
      const emp = document.createElement('div');
      emp.className = 'day-empty';
      emp.textContent = isToday ? '尚無記錄' : '無記錄';
      tl.appendChild(emp);
    } else {
      evs.forEach(ev => {
        const isEd = editKey === key && editId === ev.id;
        const row = document.createElement('div');
        row.className = 'ev-row' + (isEd ? ' editing' : '');

        const nm = document.createElement('div');
        nm.className = 'ev-name' + (ev.name ? '' : ' ph');
        nm.textContent = ev.name || '未命名…';

        const mn = document.createElement('div');
        mn.className = 'ev-min';
        mn.textContent = ev.min ? ev.min + ' 分' : '—';

        const del = document.createElement('button');
        del.className = 'ev-del';
        del.textContent = '✕';
        del.setAttribute('aria-label', '刪除');
        del.addEventListener('click', e => {
          e.stopPropagation();
          deleteEvent(ev.id);
          if (editId === ev.id) { editKey = null; editId = null; }
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
            editKey = null; editId = null;
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
          render();
        });

        tl.appendChild(row);
      });
    }

    block.appendChild(tl);
    if (di < 6) {
      const hr = document.createElement('hr');
      hr.className = 'day-divider';
      block.appendChild(hr);
    }
    body.appendChild(block);
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
    screen.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;';
    const title = document.createElement('p');
    title.textContent = '時間紀錄';
    title.style.cssText = 'font-size:18px;font-weight:500;color:var(--text);';
    const btn = document.createElement('button');
    btn.textContent = '用 Google 登入';
    btn.style.cssText = 'font-family:var(--font-body);font-size:15px;padding:11px 24px;border-radius:8px;border:1px solid var(--border-mid);background:var(--surface);color:var(--text);cursor:pointer;';
    btn.addEventListener('click', () =>
      signInWithPopup(auth, provider).catch(e => showToast('登入失敗：' + e.code))
    );
    screen.append(title, btn);
    document.body.appendChild(screen);
  }
  screen.style.display = 'flex';
}

// ── Auto-focus 輸入框 ──────────────────────────────────────────────────────
function focusInput() {
  const input = $('nameIn');
  if (!input) return;
  // 手機上直接 focus 會彈出鍵盤，用 requestAnimationFrame 確保 DOM 就緒
  requestAnimationFrame(() => { input.focus({ preventScroll: true }); });
}

// 頁面從背景切回前台時重新 focus（手機 / 電腦皆適用）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('addBar')?.style.display !== 'none') {
    focusInput();
  }
});

onAuthStateChanged(auth, user => {
  if (user) {
    uid = user.uid;
    const s = $('loginScreen');
    if (s) s.style.display = 'none';
    $('app').style.display = 'flex';
    subscribeWeek(weekDays(weekOffset));
    // 登入後自動 focus 輸入框
    focusInput();
  } else {
    renderLogin();
  }
});
