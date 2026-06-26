'use strict';
// Клиент Таверны Дуэли: сессия, SSE, drag-and-drop вербовка, сочный бой, звук.

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KW = { taunt: '🛑', divineShield: '✨', windfury: '💨' };
const sfx = (n) => { try { window.SFX && SFX.play(n); } catch {} };

const api = (path, body) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json());

// ── Сессия ─────────────────────────────────────────────────
function loadSession() { try { return JSON.parse(localStorage.getItem('td_session') || 'null'); } catch { return null; } }
function saveSession(s) { localStorage.setItem('td_session', JSON.stringify(s)); session = s; }
function clearSession() { localStorage.removeItem('td_session'); session = null; }

let session = loadSession();
let es = null;
let S = null;
let animSeq = 0;
let lastCombatTurn = -1;
let failCount = 0;
let gotMessage = false;

// ── SSE ────────────────────────────────────────────────────
function connect() {
  if (!session) return;
  if (es) es.close();
  gotMessage = false;
  const u = `/api/stream?room=${encodeURIComponent(session.roomId)}&pid=${encodeURIComponent(session.pid)}&token=${encodeURIComponent(session.token)}`;
  es = new EventSource(u);
  es.onmessage = (ev) => {
    gotMessage = true; failCount = 0;
    try { S = JSON.parse(ev.data); } catch { return; }
    render(S);
  };
  es.onerror = () => { if (!gotMessage && ++failCount >= 3) { es.close(); clearSession(); goHome(); } };
  history.replaceState(null, '', `/?room=${session.roomId}`);
}

function goHome() {
  if (es) { es.close(); es = null; }
  S = null; lastCombatTurn = -1;
  history.replaceState(null, '', '/');
  showScreen('screen-home');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
}

// ── Рендер ─────────────────────────────────────────────────
let timerTick = null;

function render(S) {
  if (!S) return;
  if (S.waiting && S.phase === 'lobby') { renderLobby(S); return; }
  if (S.phase === 'gameover') { renderOver(S); return; }

  showScreen('screen-game');
  renderTopbar(S);

  if (S.phase === 'combat' && S.combat) {
    $('#recruit').classList.add('hidden');
    $('#sell-zone').classList.remove('active');
    $('#arena').classList.remove('hidden');
    if (S.turn !== lastCombatTurn) { lastCombatTurn = S.turn; animateCombat(S.combat); }
  } else {
    $('#arena').classList.add('hidden');
    $('#recruit').classList.remove('hidden');
    renderRecruit(S);
  }
  startTimer();
}

function animateNumber(el, to) {
  const from = parseInt(el.textContent, 10);
  if (isNaN(from) || from === to) { el.textContent = to; return; }
  const dur = 450, t0 = performance.now();
  let done = false;
  (function step(t) {
    if (done) return;
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step); else done = true;
  })(t0);
  // Гарантия итогового значения, даже если rAF тормозится (фон/headless).
  setTimeout(() => { if (!done) { el.textContent = to; done = true; } }, dur + 100);
}

function renderTopbar(S) {
  const { you, opp } = S;
  $('#opp-name').textContent = opp ? opp.name : 'Соперник';
  $('#opp-tier').textContent = '⭐' + (opp ? opp.tier : 1);
  $('#opp-board').textContent = opp ? opp.boardCount : 0;
  $('#opp-ready').classList.toggle('on', !!(opp && opp.ready));
  $('#you-name').textContent = you ? you.name : 'Ты';
  $('#turn-num').textContent = S.turn;
  if (you) animateNumber($('#you-gold'), you.gold);
  // HP во время боя не трогаем — спишем в момент удара (без спойлера)
  if (S.phase !== 'combat') {
    if (opp) animateNumber($('#opp-hp'), opp.hp);
    if (you) animateNumber($('#you-hp'), you.hp);
  }
}

function startTimer() {
  if (timerTick) return;
  let lastLow = false;
  timerTick = setInterval(() => {
    if (!S) return;
    const el = $('#timer');
    if (S.phase === 'recruit') {
      const left = Math.max(0, Math.ceil((S.phaseEndsAt - Date.now()) / 1000));
      el.textContent = left;
      const low = left <= 10;
      el.classList.toggle('low', low);
      if (low && !lastLow && left > 0) sfx('hover');
      lastLow = low;
    } else if (S.phase === 'combat') { el.textContent = '⚔'; el.classList.remove('low'); lastLow = false; }
  }, 250);
}

function renderLobby(S) { showScreen('screen-lobby'); $('#lobby-code').textContent = S.roomId; }

// ── Карта ──────────────────────────────────────────────────
function cardEl(m, ctx) {
  const el = document.createElement('div');
  el.className = 'card t' + m.tier;
  if (m.keywords.includes('taunt')) el.classList.add('taunt');
  if (m.divineShield) el.classList.add('shield');
  const kws = m.keywords.filter((k) => k !== 'divineShield').map((k) => KW[k] || '').join('');
  const shieldIcon = m.divineShield ? KW.divineShield : '';
  el.innerHTML = `
    <span class="tier-pip">⭐${m.tier}</span>
    <span class="kw">${shieldIcon}${kws}</span>
    <span class="emoji">${m.emoji}</span>
    <span class="cname">${m.name}</span>
    <span class="stats"><span class="atk">${m.attack}</span><span class="hp">${m.health}</span></span>`;
  el.dataset.uid = m.uid;
  return el;
}

function renderRecruit(S) {
  const you = S.you;
  const up = $('#btn-upgrade');
  if (you.tier >= 6) { up.innerHTML = 'Таверна ⭐6 · MAX'; up.disabled = true; }
  else { up.innerHTML = `Таверна ⭐${you.tier} · ↑${you.upgradeCost}💰`; up.disabled = you.gold < you.upgradeCost; }
  $('#btn-reroll').disabled = you.gold < S.config.rerollCost;

  const shop = $('#shop'); shop.innerHTML = '';
  shop.classList.toggle('empty', you.shop.length === 0);
  you.shop.forEach((m) => {
    const el = cardEl(m, 'shop');
    if (you.gold < S.config.buyCost || you.board.length >= S.config.maxBoard) el.classList.add('too-pricey');
    attachDrag(el, m, 'shop');
    shop.appendChild(el);
  });

  const board = $('#board'); board.innerHTML = '';
  board.classList.toggle('empty', you.board.length === 0);
  you.board.forEach((m) => {
    const el = cardEl(m, 'board');
    attachDrag(el, m, 'board');
    board.appendChild(el);
  });

  const rb = $('#btn-ready');
  if (you.ready) { rb.textContent = 'Готов ✓ — ждём соперника…'; rb.classList.add('waiting'); rb.disabled = true; }
  else { rb.textContent = 'В БОЙ ⚔️'; rb.classList.remove('waiting'); rb.disabled = false; }
}

// ── Drag-and-drop (pointer events) ─────────────────────────
let drag = null; // { el, ghost, m, role, offX, offY, moved }

function attachDrag(el, m, role) {
  el.addEventListener('pointerdown', (e) => {
    if (drag) return;
    sfx('hover'); window.SFX && SFX.unlock();
    const r = el.getBoundingClientRect();
    drag = { el, m, role, startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, ghost: null, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || drag.el !== el) return;
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.moved && dist > 8) startGhost();
    if (drag.moved) moveGhost(e.clientX, e.clientY);
  });
  el.addEventListener('pointerup', (e) => { if (drag && drag.el === el) endDrag(e.clientX, e.clientY); });
  el.addEventListener('pointercancel', () => { if (drag && drag.el === el) cancelDrag(); });
}

function startGhost() {
  drag.moved = true;
  const g = drag.el.cloneNode(true);
  g.classList.add('ghost');
  const r = drag.el.getBoundingClientRect();
  g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
  document.body.appendChild(g);
  drag.ghost = g;
  drag.el.classList.add('dragging');
  if (drag.role === 'board') $('#sell-zone').classList.add('active');
}

function moveGhost(x, y) {
  drag.ghost.style.left = (x - drag.offX) + 'px';
  drag.ghost.style.top = (y - drag.offY) + 'px';
  drag.ghost.style.display = 'none';
  const under = document.elementFromPoint(x, y);
  drag.ghost.style.display = '';
  const overSell = under && under.closest('#sell-zone');
  const overBoard = under && under.closest('#board');
  $('#sell-zone').classList.toggle('drop-ok', !!overSell && drag.role === 'board');
  $('#board').classList.toggle('drop-ok', !!overBoard && !overSell);
}

function endDrag(x, y) {
  const d = drag;
  if (!d.moved) { // это тап
    cleanupDrag();
    if (d.role === 'shop') buyCard(d.m, d.el);
    return;
  }
  d.ghost.style.display = 'none';
  const under = document.elementFromPoint(x, y);
  const overSell = under && under.closest('#sell-zone');
  const overBoard = under && under.closest('#board');
  cleanupDrag();

  if (d.role === 'shop') {
    if (overBoard) buyCard(d.m, d.el);
  } else { // board
    if (overSell) { sfx('sell'); act({ type: 'sell', uid: d.m.uid }); }
    else if (overBoard) {
      const order = computeOrder($('#board'), d.m.uid, x);
      sfx('click');
      act({ type: 'reorder', order });
    }
  }
}

function computeOrder(board, uid, x) {
  const cards = [...board.querySelectorAll('.card')].map((c) => c.dataset.uid);
  const without = cards.filter((u) => u !== uid);
  const els = [...board.querySelectorAll('.card')].filter((c) => c.dataset.uid !== uid);
  let idx = without.length;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) { idx = i; break; }
  }
  without.splice(idx, 0, uid);
  return without;
}

function cancelDrag() { cleanupDrag(); }
function cleanupDrag() {
  if (!drag) return;
  if (drag.ghost) drag.ghost.remove();
  drag.el.classList.remove('dragging');
  $('#sell-zone').classList.remove('drop-ok', 'active');
  $('#board').classList.remove('drop-ok');
  drag = null;
}

function buyCard(m, el) {
  if (el && el.classList.contains('too-pricey')) { sfx('sell'); toast('Не хватает золота / борд полон'); return; }
  sfx('buy');
  if (el) el.classList.add('buying');
  act({ type: 'buy', uid: m.uid });
}

// ── Сочный бой ─────────────────────────────────────────────
async function animateCombat(combat) {
  const token = ++animSeq;
  const youSide = combat.youSide;
  const oppSide = youSide === 'a' ? 'b' : 'a';
  const arenaOpp = $('#arena-opp'); arenaOpp.innerHTML = '';
  const arenaYou = $('#arena-you'); arenaYou.innerHTML = '';
  $('#arena-banner').classList.add('hidden');

  const elMap = {};
  const mount = (m, side) => {
    const el = cardEl(m, 'arena');
    (side === youSide ? arenaYou : arenaOpp).appendChild(el);
    elMap[m.uid] = { el, side };
  };
  combat.boards[oppSide].forEach((m) => mount(m, oppSide));
  combat.boards[youSide].forEach((m) => mount(m, youSide));

  await sleep(650);

  for (const ev of combat.log) {
    if (token !== animSeq) return;
    if (ev.type === 'attack') {
      const atk = elMap[ev.attackerUid], def = elMap[ev.defenderUid];
      if (atk && def) {
        sfx('attack');
        const a = atk.el.getBoundingClientRect(), d = def.el.getBoundingClientRect();
        const dx = (d.left + d.width / 2) - (a.left + a.width / 2);
        const dy = (d.top + d.height / 2) - (a.top + a.height / 2);
        atk.el.classList.add('attacker');
        atk.el.style.transform = `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1.12)`;
        await sleep(165);
        if (token !== animSeq) return;
        def.el.classList.add('struck'); spark(def.el);
        atk.el.style.transform = '';
        await sleep(150);
        atk.el.classList.remove('attacker'); def.el.classList.remove('struck');
      }
    } else if (ev.type === 'damage') {
      const t = elMap[ev.uid];
      if (t) { sfx('hit'); floatText(t.el, '-' + ev.amount, 'dmg-float'); const hp = t.el.querySelector('.hp'); if (hp) hp.textContent = Math.max(0, ev.health); }
      await sleep(30);
    } else if (ev.type === 'shield') {
      const t = elMap[ev.uid];
      if (t) { sfx('shield'); floatText(t.el, '✨', 'shield-pop'); t.el.classList.remove('shield'); }
      await sleep(120);
    } else if (ev.type === 'death') {
      const t = elMap[ev.uid];
      if (t) { sfx('death'); t.el.classList.add('perish'); const e = t.el; spark(e); setTimeout(() => e.remove(), 450); delete elMap[ev.uid]; }
      await sleep(240);
    } else if (ev.type === 'summon') {
      mount(ev.minion, ev.side);
      const nm = elMap[ev.minion.uid]; if (nm) nm.el.classList.add('buying');
      await sleep(160);
    } else if (ev.type === 'result') {
      if (token !== animSeq) return;
      // списываем HP проигравшего в кадре
      if (S && S.you) animateNumber($('#you-hp'), S.you.hp);
      if (S && S.opp) animateNumber($('#opp-hp'), S.opp.hp);
      if (ev.damage > 0) {
        $('#arena').classList.add('shake');
        sfx('heroHit');
        const loser = ev.winner === youSide ? '#hero-opp' : '#hero-you';
        $(loser).classList.add('hurt');
        setTimeout(() => { $('#arena').classList.remove('shake'); $(loser).classList.remove('hurt'); }, 500);
      }
      showBanner(ev.winner, ev.damage, youSide);
      if (ev.winner === 'draw') sfx('click');
      else if (ev.winner === youSide) sfx('win'); else sfx('lose');
    }
  }
}

function floatText(parent, text, cls) {
  const f = document.createElement('div');
  f.className = cls; f.textContent = text;
  f.style.left = '50%'; f.style.top = '8%'; f.style.transform = 'translateX(-50%)';
  parent.appendChild(f);
  setTimeout(() => f.remove(), 800);
}

function spark(el) {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const colors = ['#f4d27a', '#ff7a72', '#fff0c8'];
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('div');
    s.className = 'spark'; s.style.background = colors[i % 3];
    s.style.left = cx + 'px'; s.style.top = cy + 'px';
    document.body.appendChild(s);
    const ang = Math.random() * 6.283, dist = 22 + Math.random() * 34;
    s.animate(
      [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(0)`, opacity: 0 }],
      { duration: 460, easing: 'cubic-bezier(.2,.8,.3,1)' });
    setTimeout(() => s.remove(), 470);
  }
}

function showBanner(winner, damage, youSide) {
  const b = $('#arena-banner');
  let cls, txt, sub;
  if (winner === 'draw') { cls = 'banner-draw'; txt = 'Ничья'; sub = 'Никто не пострадал'; }
  else if (winner === youSide) { cls = 'banner-win'; txt = 'Победа в бою! 🏆'; sub = `Соперник теряет ${damage} ❤️`; }
  else { cls = 'banner-lose'; txt = 'Бой проигран 💥'; sub = `Ты теряешь ${damage} ❤️`; }
  b.className = 'arena-banner ' + cls;
  b.innerHTML = `${txt}<div class="banner-sub">${sub}</div>`;
}

function renderOver(S) {
  showScreen('screen-over');
  const t = $('#over-title');
  if (!S.gameover.winnerId) { t.textContent = 'Ничья 🤝'; t.className = ''; $('#over-sub').textContent = 'Оба пали в один ход.'; sfx('click'); }
  else if (S.gameover.youWon) { t.textContent = 'Победа! 🏆'; t.className = 'win'; $('#over-sub').textContent = 'Ты затащил. Реванш?'; sfx('win'); }
  else { t.textContent = 'Поражение 💀'; t.className = 'lose'; $('#over-sub').textContent = 'Кореш оказался сильнее. Реванш?'; sfx('lose'); }
}

// ── Действия / тосты ───────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const t = $('#game-toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1600);
}

async function act(action) {
  if (!session) return;
  const r = await api('/api/action', { roomId: session.roomId, pid: session.pid, token: session.token, action });
  if (r && r.error) toast(r.error);
}

// ── Старт / UI ─────────────────────────────────────────────
function init() {
  const params = new URLSearchParams(location.search);
  const deepRoom = (params.get('room') || '').toUpperCase();

  $('#name-input').value = localStorage.getItem('td_name') || '';
  $('#name-input').addEventListener('input', (e) => localStorage.setItem('td_name', e.target.value));
  if (deepRoom) $('#code-input').value = deepRoom;

  // звук
  const sb = $('#sound-btn');
  sb.textContent = (window.SFX && SFX.isMuted()) ? '🔇' : '🔊';
  sb.addEventListener('click', () => { const m = SFX.toggleMute(); sb.textContent = m ? '🔇' : '🔊'; });
  window.addEventListener('pointerdown', () => { window.SFX && SFX.unlock(); }, { once: true });

  if (session && (!deepRoom || session.roomId === deepRoom)) { connect(); }
  else { showScreen('screen-home'); if (deepRoom) setTimeout(() => $('#name-input').focus(), 100); }

  $('#btn-create').addEventListener('click', async () => {
    sfx('click');
    const name = ($('#name-input').value || 'Игрок').trim();
    const r = await api('/api/create', { name });
    if (r.error) return ($('#home-error').textContent = r.error);
    saveSession({ roomId: r.roomId, pid: r.pid, token: r.token, name });
    connect();
  });

  $('#btn-join').addEventListener('click', async () => {
    sfx('click');
    const roomId = ($('#code-input').value || '').toUpperCase().trim();
    const name = ($('#name-input').value || 'Игрок').trim();
    if (roomId.length !== 4) return ($('#home-error').textContent = 'Код — 4 символа');
    const r = await api('/api/join', { roomId, name });
    if (r.error) return ($('#home-error').textContent = r.error);
    saveSession({ roomId: r.roomId, pid: r.pid, token: r.token, name });
    connect();
  });

  $('#code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });

  $('#btn-copy').addEventListener('click', async () => {
    sfx('buy');
    const link = `${location.origin}/?room=${session.roomId}`;
    try { await navigator.clipboard.writeText(link); } catch { prompt('Скопируй ссылку:', link); }
    $('#copy-hint').textContent = 'Ссылка скопирована! 📋';
  });

  $('#btn-upgrade').addEventListener('click', () => { sfx('upgrade'); act({ type: 'upgrade' }); });
  $('#btn-reroll').addEventListener('click', () => { sfx('reroll'); act({ type: 'reroll' }); });
  $('#btn-ready').addEventListener('click', () => { sfx('ready'); act({ type: 'ready' }); });
  $('#btn-rematch').addEventListener('click', () => { sfx('click'); api('/api/rematch', { roomId: session.roomId, pid: session.pid, token: session.token }); });
  $('#btn-home').addEventListener('click', () => { sfx('click'); goHome(); });
}

init();
