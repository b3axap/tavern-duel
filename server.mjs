// HTTP + SSE сервер. Только маршрутизация и сеть; игровая логика — в lib/game.mjs.
// Чистый Node (≥18), без зависимостей. Запуск: node server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createRoom, addPlayer, applyAction, resolveRound, endCombat, rematch, viewFor,
} from './lib/game.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

/** @type {Map<string, object>} */
const rooms = new Map();
/** roomId -> Set<{ pid, res }> */
const clients = new Map();
/** roomId -> Timeout */
const timers = new Map();

// ── Таймеры фаз ─────────────────────────────────────────────
function clearTimer(roomId) {
  const t = timers.get(roomId);
  if (t) { clearTimeout(t); timers.delete(roomId); }
}

function armTimer(room) {
  clearTimer(room.id);
  const delay = Math.max(0, room.phaseEndsAt - Date.now());
  if (room.phase === 'recruit') {
    timers.set(room.id, setTimeout(() => { forceCombat(room); }, delay));
  } else if (room.phase === 'combat') {
    timers.set(room.id, setTimeout(() => {
      endCombat(room);
      armTimer(room);
      broadcast(room);
    }, delay));
  }
}

function forceCombat(room) {
  if (room.phase !== 'recruit') return;
  resolveRound(room);
  armTimer(room);
  broadcast(room);
}

// ── Рассылка состояния по SSE ──────────────────────────────
function broadcast(room) {
  const set = clients.get(room.id);
  if (!set) return;
  for (const c of set) {
    try {
      const view = viewFor(room, c.pid);
      c.res.write(`data: ${JSON.stringify(view)}\n\n`);
    } catch { /* клиент отвалился — почистим на close */ }
  }
}

// ── Утилиты HTTP ───────────────────────────────────────────
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC) || !existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(500); res.end('Server error');
  }
}

// Проверяет токен игрока в комнате.
function auth(room, pid, token) {
  const p = room && room.players[pid];
  return p && p.token === token ? p : null;
}

// ── Сервер ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // SSE-поток
  if (pathname === '/api/stream' && req.method === 'GET') {
    const roomId = (url.searchParams.get('room') || '').toUpperCase();
    const pid = url.searchParams.get('pid');
    const token = url.searchParams.get('token');
    const room = rooms.get(roomId);
    const p = auth(room, pid, token);
    if (!p) { res.writeHead(403); res.end('forbidden'); return; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    p.connected = true;

    let set = clients.get(roomId);
    if (!set) { set = new Set(); clients.set(roomId, set); }
    const client = { pid, res };
    set.add(client);

    // Сразу отдать текущее состояние.
    res.write(`data: ${JSON.stringify(viewFor(room, pid))}\n\n`);

    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(client);
      if (![...set].some((c) => c.pid === pid)) p.connected = false;
    });
    return;
  }

  // Создать комнату
  if (pathname === '/api/create' && req.method === 'POST') {
    const body = await readBody(req);
    const room = createRoom();
    rooms.set(room.id, room);
    const r = addPlayer(room, (body.name || '').slice(0, 16));
    return sendJSON(res, 200, { roomId: room.id, pid: r.pid, token: r.token });
  }

  // Войти в комнату
  if (pathname === '/api/join' && req.method === 'POST') {
    const body = await readBody(req);
    const roomId = (body.roomId || '').toUpperCase().trim();
    const room = rooms.get(roomId);
    if (!room) return sendJSON(res, 404, { error: 'Комната не найдена' });
    const r = addPlayer(room, (body.name || '').slice(0, 16));
    if (r.error) return sendJSON(res, 409, { error: r.error });
    if (room.phase === 'recruit' && room.turn === 1) armTimer(room); // стартовал отсчёт
    broadcast(room);
    return sendJSON(res, 200, { roomId: room.id, pid: r.pid, token: r.token });
  }

  // Действие игрока
  if (pathname === '/api/action' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get((body.roomId || '').toUpperCase());
    const p = auth(room, body.pid, body.token);
    if (!p) return sendJSON(res, 403, { error: 'forbidden' });
    const result = applyAction(room, body.pid, body.action || {});
    if (!result.ok) return sendJSON(res, 400, { error: result.error });
    if (result.combat) {
      clearTimer(room.id);
      resolveRound(room);
      armTimer(room);
    }
    broadcast(room);
    return sendJSON(res, 200, { ok: true });
  }

  // Реванш
  if (pathname === '/api/rematch' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get((body.roomId || '').toUpperCase());
    const p = auth(room, body.pid, body.token);
    if (!p) return sendJSON(res, 403, { error: 'forbidden' });
    if (room.phase !== 'gameover') return sendJSON(res, 400, { error: 'Игра ещё идёт' });
    rematch(room);
    armTimer(room);
    broadcast(room);
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/healthz') return sendJSON(res, 200, { ok: true, rooms: rooms.size });

  // Статика
  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(404); res.end('Not found');
});

// Уборка пустых/протухших комнат (раз в 10 минут, старше 2 часов).
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    const stale = now - room.createdAt > 2 * 3600 * 1000;
    const empty = !clients.get(id) || clients.get(id).size === 0;
    if (stale && empty) { clearTimer(id); rooms.delete(id); clients.delete(id); }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`🍺 Таверна Дуэль — http://localhost:${PORT}`);
});

export { server };
