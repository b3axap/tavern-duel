// Состояние комнаты и игровой автомат. Чистая логика (без сети, без таймеров).
// Таймеры/сеть живут в server.mjs; здесь только переходы состояния и действия.
import { rollShop, instantiate, SHOP_SIZE, UPGRADE_COST } from './cards.mjs';
import { resolveCombat } from './combat.mjs';

export const CONFIG = {
  startHp: 25,
  maxBoard: 7,
  buyCost: 3,
  sellGain: 1,
  rerollCost: 1,
  goldCap: 10,
  recruitMs: 75000,
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих 0/O/1/I
function genCode(n, rng) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}
function genToken(rng) {
  return Math.floor(rng() * 1e9).toString(36) + Math.floor(rng() * 1e9).toString(36);
}

export function createRoom(rng = Math.random) {
  return {
    id: genCode(4, rng),
    phase: 'lobby',
    turn: 0,
    order: [],           // [pid1, pid2]
    players: {},         // pid -> player
    phaseEndsAt: 0,
    combat: null,
    winner: null,
    createdAt: Date.now(),
    version: 0,
    _rng: rng,
  };
}

function newPlayer(pid, name, token) {
  return {
    id: pid,
    name: name || 'Игрок',
    token,
    hp: CONFIG.startHp,
    tier: 1,
    gold: 0,
    baseGold: 0,
    upgradeCost: UPGRADE_COST[1],
    shop: [],
    board: [],
    ready: false,
    connected: true,
    eliminated: false,
  };
}

// Добавляет игрока. Возвращает { pid, token } или { error }.
export function addPlayer(room, name, rng = Math.random) {
  if (room.order.length >= 2) return { error: 'Комната заполнена' };
  const pid = 'p' + genCode(6, rng);
  const token = genToken(rng);
  room.players[pid] = newPlayer(pid, name, token);
  room.order.push(pid);
  room.version++;
  if (room.order.length === 2) startRecruit(room, 1);
  return { pid, token };
}

export function startRecruit(room, turn) {
  room.turn = turn;
  room.phase = 'recruit';
  room.combat = null;
  room.phaseEndsAt = Date.now() + CONFIG.recruitMs;
  for (const pid of room.order) {
    const p = room.players[pid];
    if (p.eliminated) continue;
    p.baseGold = Math.min(2 + turn, CONFIG.goldCap);
    p.gold = p.baseGold;
    p.ready = false;
    if (turn > 1 && p.tier < 6) p.upgradeCost = Math.max(0, p.upgradeCost - 1);
    p.shop = rollShop(p.tier, room._rng);
  }
  room.version++;
}

// Применяет действие игрока в фазе вербовки. Возвращает { ok } или { ok:false, error }.
// Если оба игрока готовы — добавляет combat:true (сигнал серверу резолвить бой).
export function applyAction(room, pid, action) {
  const p = room.players[pid];
  if (!p) return { ok: false, error: 'Нет игрока' };
  if (room.phase !== 'recruit') return { ok: false, error: 'Сейчас не фаза вербовки' };

  switch (action.type) {
    case 'buy': {
      const i = p.shop.findIndex((m) => m.uid === action.uid);
      if (i < 0) return { ok: false, error: 'Нет такой карты в лавке' };
      if (p.board.length >= CONFIG.maxBoard) return { ok: false, error: 'Борд полон (макс 7)' };
      if (p.gold < CONFIG.buyCost) return { ok: false, error: 'Не хватает золота' };
      p.gold -= CONFIG.buyCost;
      p.board.push(p.shop.splice(i, 1)[0]);
      break;
    }
    case 'sell': {
      const i = p.board.findIndex((m) => m.uid === action.uid);
      if (i < 0) return { ok: false, error: 'Нет такого миньона' };
      p.board.splice(i, 1);
      p.gold += CONFIG.sellGain;
      break;
    }
    case 'reroll': {
      if (p.gold < CONFIG.rerollCost) return { ok: false, error: 'Не хватает золота на реролл' };
      p.gold -= CONFIG.rerollCost;
      p.shop = rollShop(p.tier, room._rng);
      break;
    }
    case 'upgrade': {
      if (p.tier >= 6) return { ok: false, error: 'Уже максимальный тир' };
      if (p.gold < p.upgradeCost) return { ok: false, error: 'Не хватает золота на апгрейд' };
      p.gold -= p.upgradeCost;
      p.tier += 1;
      p.upgradeCost = UPGRADE_COST[p.tier];
      break;
    }
    case 'move': {
      const i = p.board.findIndex((m) => m.uid === action.uid);
      if (i < 0) return { ok: false, error: 'Нет такого миньона' };
      const j = action.dir === 'left' ? i - 1 : i + 1;
      if (j < 0 || j >= p.board.length) return { ok: false, error: 'Некуда двигать' };
      [p.board[i], p.board[j]] = [p.board[j], p.board[i]];
      break;
    }
    case 'reorder': {
      const order = action.order;
      if (!Array.isArray(order) || order.length !== p.board.length) return { ok: false, error: 'Кривой порядок' };
      const cur = new Map(p.board.map((m) => [m.uid, m]));
      if (!order.every((uid) => cur.has(uid))) return { ok: false, error: 'Кривой порядок' };
      p.board = order.map((uid) => cur.get(uid));
      break;
    }
    case 'ready': {
      p.ready = true;
      break;
    }
    default:
      return { ok: false, error: 'Неизвестное действие' };
  }
  room.version++;

  const alive = room.order.map((id) => room.players[id]).filter((x) => !x.eliminated);
  if (alive.length === 2 && alive.every((x) => x.ready)) {
    return { ok: true, combat: true };
  }
  return { ok: true };
}

// Резолвит бой между двумя игроками, применяет урон, переводит комнату в фазу боя.
// Возвращает длительность анимации в мс (серверу — для setTimeout до следующего раунда).
export function resolveRound(room) {
  const [pa, pb] = room.order.map((id) => room.players[id]);
  const seed = Math.floor(room._rng() * 2 ** 31) >>> 0;
  const res = resolveCombat(pa.board, pb.board, pa.tier, pb.tier, seed);

  if (res.winner === 'a') pb.hp -= res.damage;
  else if (res.winner === 'b') pa.hp -= res.damage;

  // Снимок бордов до боя — клиент проигрывает анимацию по нему + логу.
  const snapshot = (b) => b.map((m) => ({
    uid: m.uid, id: m.id, name: m.name, emoji: m.emoji, tier: m.tier,
    attack: m.attack, health: m.health, maxHealth: m.maxHealth,
    keywords: [...m.keywords], divineShield: !!m.divineShield,
  }));

  room.phase = 'combat';
  room.combat = {
    seed,
    log: res.log,
    winner: res.winner,
    damage: res.damage,
    sides: { a: pa.id, b: pb.id },
    boards: { a: snapshot(pa.board), b: snapshot(pb.board) },
  };

  for (const p of [pa, pb]) {
    p.ready = false;
    if (p.hp <= 0) { p.hp = 0; p.eliminated = true; }
  }

  // Длительность: пауза + по событию атаки/смерти.
  const beats = res.log.filter((e) => e.type === 'attack' || e.type === 'death').length;
  const durationMs = 2200 + beats * 650 + 1800;
  room.phaseEndsAt = Date.now() + durationMs;
  room.version++;
  return durationMs;
}

// Завершает фазу боя: либо конец игры, либо следующий раунд вербовки.
export function endCombat(room) {
  const dead = room.order.map((id) => room.players[id]).filter((p) => p.eliminated);
  if (dead.length >= 1) {
    const alive = room.order.map((id) => room.players[id]).filter((p) => !p.eliminated);
    room.phase = 'gameover';
    room.winner = alive.length === 1 ? alive[0].id : null; // null = ничья (оба пали)
    room.phaseEndsAt = 0;
    room.version++;
    return;
  }
  startRecruit(room, room.turn + 1);
}

// Сбрасывает комнату для матча-реванша.
export function rematch(room) {
  for (const pid of room.order) {
    const p = room.players[pid];
    p.hp = CONFIG.startHp;
    p.tier = 1;
    p.upgradeCost = UPGRADE_COST[1];
    p.board = [];
    p.shop = [];
    p.ready = false;
    p.eliminated = false;
  }
  room.winner = null;
  room.combat = null;
  startRecruit(room, 1);
}

// Персональный вид состояния для конкретного игрока (скрывает чужую лавку/борд в вербовке).
export function viewFor(room, pid) {
  const me = room.players[pid];
  const oppId = room.order.find((id) => id !== pid);
  const opp = oppId ? room.players[oppId] : null;

  const base = {
    roomId: room.id,
    phase: room.phase,
    turn: room.turn,
    version: room.version,
    phaseEndsAt: room.phaseEndsAt,
    config: { buyCost: CONFIG.buyCost, sellGain: CONFIG.sellGain, rerollCost: CONFIG.rerollCost, maxBoard: CONFIG.maxBoard },
    you: me ? {
      id: me.id, name: me.name, hp: me.hp, tier: me.tier, gold: me.gold,
      upgradeCost: me.upgradeCost, shop: me.shop, board: me.board,
      ready: me.ready, eliminated: me.eliminated,
    } : null,
    opp: opp ? {
      id: opp.id, name: opp.name, hp: opp.hp, tier: opp.tier,
      boardCount: opp.board.length, ready: opp.ready,
      connected: opp.connected, eliminated: opp.eliminated,
    } : null,
    waiting: room.order.length < 2,
  };

  if (room.phase === 'combat' && room.combat) {
    const youSide = room.combat.sides.a === pid ? 'a' : 'b';
    base.combat = {
      youSide,
      log: room.combat.log,
      winner: room.combat.winner,
      damage: room.combat.damage,
      boards: room.combat.boards,
    };
  }
  if (room.phase === 'gameover') {
    base.gameover = { winnerId: room.winner, youWon: room.winner === pid };
  }
  return base;
}
