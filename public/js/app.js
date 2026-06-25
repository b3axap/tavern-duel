'use strict';
// Клиент Таверны Дуэли: сессия, SSE, рендер вербовки, анимация боя.

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KW = { taunt: '🛑', divineShield: '✨', windfury: '💨' };

const api = (path, body) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json());

// ── Сессия ─────────────────────────────────────────────────
function loadSession() {
  try { return JSON.parse(localStorage.getItem('td_session') || 'null'); } catch { return null; }
}
function saveSession(s) { localStorage.setItem('td_session', JSON.stringify(s)); session = s; }
function clearSession() { localStorage.removeItem('td_session'); session = null; }

let session = loadSession();
let es = null;
let S = null;            // последнее состояние от сервера
let animSeq = 0;         // токен текущей анимации боя
let lastCombatTurn = -1; // чтобы не переигрывать бой повторно
let failCount = 0;
let gotMessage = false;

// ── Экраны ─────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
}

// ── Подключение SSE ────────────────────────────────────────
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
  es.onerror = () => {
    if (!gotMessage && ++failCount >= 3) { es.close(); clearSession(); goHome(); }
  };
  history.replaceState(null, '', `/?room=${session.roomId}`);
}

function goHome() {
  if (es) { es.close(); es = null; }
  S = null; lastCombatTurn = -1;
  history.replaceState(null, '', '/');
  showScreen('screen-home');
}

// ── Рендер ─────────────────────────────────────────────────
let timerTick = null;

function render(S) {
  if (!S) return;
  if (S.waiting && S.phase === 'lobby') { renderLobby(S); return; }

  if (S.phase === 'gameover') { renderOver(S); return; }

  // recruit / combat → игровой экран
  showScreen('screen-game');
  renderTopbar(S);

  if (S.phase === 'combat' && S.combat) {
    $('#recruit').classList.add('hidden');
    $('#arena').classList.remove('hidden');
    if (S.turn !== lastCombatTurn) {
      lastCombatTurn = S.turn;
      animateCombat(S.combat);
    }
  } else { // recruit
    $('#arena').classList.add('hidden');
    $('#recruit').classList.remove('hidden');
    renderRecruit(S);
  }
  startTimer();
}

function renderTopbar(S) {
  const { you, opp } = S;
  $('#opp-name').textContent = opp ? opp.name : 'Соперник';
  $('#opp-hp').textContent = opp ? opp.hp : '—';
  $('#opp-tier').textContent = '⭐' + (opp ? opp.tier : 1);
  $('#opp-board').textContent = opp ? opp.boardCount : 0;
  $('#opp-ready').classList.toggle('on', !!(opp && opp.ready));
  $('#you-name').textContent = you ? you.name : 'Ты';
  $('#you-hp').textContent = you ? you.hp : '—';
  $('#you-gold').textContent = you ? you.gold : 0;
  $('#turn-num').textContent = S.turn;
}

function startTimer() {
  if (timerTick) return;
  timerTick = setInterval(() => {
    if (!S) return;
    const el = $('#timer');
    if (S.phase === 'recruit') {
      const left = Math.max(0, Math.ceil((S.phaseEndsAt - Date.now()) / 1000));
      el.textContent = left;
      el.classList.toggle('low', left <= 10);
    } else if (S.phase === 'combat') {
      el.textContent = '⚔';
      el.classList.remove('low');
    }
  }, 250);
}

function renderLobby(S) {
  showScreen('screen-lobby');
  $('#lobby-code').textContent = S.roomId;
}

// карточка миньона
function cardEl(m, ctx) {
  const el = document.createElement('div');
  el.className = 'card';
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
  if (ctx === 'board') {
    const moves = document.createElement('div');
    moves.className = 'moves';
    moves.innerHTML = `<button class="move-btn mv-l">◀</button><button class="move-btn mv-r">▶</button>`;
    el.appendChild(moves);
  }
  el.dataset.uid = m.uid;
  return el;
}

function renderRecruit(S) {
  const you = S.you;
  // таверна (собираем innerHTML целиком — без отдельных ссылок на вложенные спаны)
  const up = $('#btn-upgrade');
  if (you.tier >= 6) { up.innerHTML = 'Таверна ⭐6 · MAX'; up.disabled = true; }
  else { up.innerHTML = `Таверна ⭐${you.tier} · ↑${you.upgradeCost}💰`; up.disabled = you.gold < you.upgradeCost; }
  $('#btn-reroll').disabled = you.gold < S.config.rerollCost;

  // лавка
  const shop = $('#shop'); shop.innerHTML = '';
  shop.classList.toggle('empty', you.shop.length === 0);
  you.shop.forEach((m) => {
    const el = cardEl(m, 'shop');
    if (you.gold < S.config.buyCost || you.board.length >= S.config.maxBoard) el.classList.add('too-pricey');
    el.addEventListener('click', () => act({ type: 'buy', uid: m.uid }));
    shop.appendChild(el);
  });

  // борд
  const board = $('#board'); board.innerHTML = '';
  board.classList.toggle('empty', you.board.length === 0);
  you.board.forEach((m) => {
    const el = cardEl(m, 'board');
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('mv-l')) return act({ type: 'move', uid: m.uid, dir: 'left' });
      if (e.target.classList.contains('mv-r')) return act({ type: 'move', uid: m.uid, dir: 'right' });
      act({ type: 'sell', uid: m.uid });
    });
    board.appendChild(el);
  });

  // кнопка готовности
  const rb = $('#btn-ready');
  if (you.ready) { rb.textContent = 'Готов ✓ — ждём соперника…'; rb.classList.add('waiting'); rb.disabled = true; }
  else { rb.textContent = 'В БОЙ ⚔️'; rb.classList.remove('waiting'); rb.disabled = false; }
}

// ── Анимация боя ───────────────────────────────────────────
async function animateCombat(combat) {
  const token = ++animSeq;
  const youSide = combat.youSide;
  const oppSide = youSide === 'a' ? 'b' : 'a';
  const arenaOpp = $('#arena-opp'); arenaOpp.innerHTML = '';
  const arenaYou = $('#arena-you'); arenaYou.innerHTML = '';
  $('#arena-banner').classList.add('hidden');

  const elMap = {}; // uid -> {el, side}
  const mount = (m, side) => {
    const el = cardEl(m, 'arena');
    (side === youSide ? arenaYou : arenaOpp).appendChild(el);
    elMap[m.uid] = { el, side };
  };
  combat.boards[oppSide].forEach((m) => mount(m, oppSide));
  combat.boards[youSide].forEach((m) => mount(m, youSide));

  await sleep(700);

  for (const ev of combat.log) {
    if (token !== animSeq) return; // состояние сменилось — прерываем
    if (ev.type === 'attack') {
      const atk = elMap[ev.attackerUid];
      const def = elMap[ev.defenderUid];
      if (atk) {
        const dir = atk.side === youSide ? -1 : 1;
        atk.el.style.transition = 'transform .14s';
        atk.el.style.transform = `translateY(${dir * -22}px) scale(1.12)`;
        await sleep(150);
        if (def) { def.el.classList.add('hit'); setTimeout(() => def.el.classList.remove('hit'), 250); }
        atk.el.style.transform = '';
        await sleep(160);
      }
    } else if (ev.type === 'damage') {
      const t = elMap[ev.uid];
      if (t) {
        floatText(t.el, '-' + ev.amount, 'dmg-float');
        const hp = t.el.querySelector('.hp');
        if (hp) hp.textContent = Math.max(0, ev.health);
      }
      await sleep(40);
    } else if (ev.type === 'shield') {
      const t = elMap[ev.uid];
      if (t) { floatText(t.el, '✨', 'shield-pop'); t.el.classList.remove('shield'); }
      await sleep(120);
    } else if (ev.type === 'death') {
      const t = elMap[ev.uid];
      if (t) { t.el.classList.add('dead'); const e = t.el; setTimeout(() => e.remove(), 400); delete elMap[ev.uid]; }
      await sleep(260);
    } else if (ev.type === 'summon') {
      mount(ev.minion, ev.side);
      await sleep(150);
    } else if (ev.type === 'result') {
      showBanner(ev.winner, ev.damage, youSide);
    }
  }
}

function floatText(parent, text, cls) {
  const f = document.createElement('div');
  f.className = cls; f.textContent = text;
  f.style.left = '50%'; f.style.top = '20%'; f.style.transform = 'translateX(-50%)';
  parent.appendChild(f);
  setTimeout(() => f.remove(), 750);
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
  if (!S.gameover.winnerId) { t.textContent = 'Ничья 🤝'; t.className = ''; $('#over-sub').textContent = 'Оба пали в один ход.'; }
  else if (S.gameover.youWon) { t.textContent = 'Победа! 🏆'; t.className = 'win'; $('#over-sub').textContent = 'Ты затащил. Реванш?'; }
  else { t.textContent = 'Поражение 💀'; t.className = 'lose'; $('#over-sub').textContent = 'Кореш оказался сильнее. Реванш?'; }
}

// ── Действия ───────────────────────────────────────────────
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

// ── Старт / события UI ─────────────────────────────────────
function init() {
  const params = new URLSearchParams(location.search);
  const deepRoom = (params.get('room') || '').toUpperCase();

  $('#name-input').value = localStorage.getItem('td_name') || '';
  $('#name-input').addEventListener('input', (e) => localStorage.setItem('td_name', e.target.value));

  if (deepRoom) $('#code-input').value = deepRoom;

  // если есть живая сессия в той же комнате — переподключаемся
  if (session && (!deepRoom || session.roomId === deepRoom)) {
    connect();
  } else {
    showScreen('screen-home');
    if (deepRoom) setTimeout(() => $('#name-input').focus(), 100);
  }

  $('#btn-create').addEventListener('click', async () => {
    const name = ($('#name-input').value || 'Игрок').trim();
    const r = await api('/api/create', { name });
    if (r.error) return ($('#home-error').textContent = r.error);
    saveSession({ roomId: r.roomId, pid: r.pid, token: r.token, name });
    connect();
  });

  $('#btn-join').addEventListener('click', async () => {
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
    const link = `${location.origin}/?room=${session.roomId}`;
    try { await navigator.clipboard.writeText(link); }
    catch { prompt('Скопируй ссылку:', link); }
    $('#copy-hint').textContent = 'Ссылка скопирована! 📋';
  });

  $('#btn-upgrade').addEventListener('click', () => act({ type: 'upgrade' }));
  $('#btn-reroll').addEventListener('click', () => act({ type: 'reroll' }));
  $('#btn-ready').addEventListener('click', () => act({ type: 'ready' }));

  $('#btn-rematch').addEventListener('click', () => api('/api/rematch', { roomId: session.roomId, pid: session.pid, token: session.token }));
  $('#btn-home').addEventListener('click', goHome);
}

init();
