// Чистый резолвер боя двух бордов. Детерминирован при заданном rng.
// Возвращает { winner: 'a'|'b'|'draw', damage, log }.
// log — последовательность событий для анимации на клиенте.
import { instantiate } from './cards.mjs';

// Сидируемый ГПСЧ (mulberry32) — один и тот же сид → один и тот же бой.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Глубокая копия миньона для боя (бой не мутирует исходный борд).
function clone(m) {
  return {
    uid: m.uid, id: m.id, name: m.name, emoji: m.emoji, tier: m.tier,
    attack: m.attack, health: m.health, maxHealth: m.maxHealth,
    keywords: [...m.keywords],
    divineShield: !!m.divineShield,
    deathrattle: m.deathrattle ? { ...m.deathrattle } : null,
  };
}

function pickDefenderIndex(board, rng) {
  const taunts = board.filter((m) => m.keywords.includes('taunt'));
  const pool = taunts.length ? taunts : board;
  const chosen = pool[Math.floor(rng() * pool.length)];
  return board.indexOf(chosen);
}

// Наносит урон миньону с учётом щита. Пишет события в log. Возвращает true, если умер.
function dealDamage(side, idx, minion, amount, log) {
  if (amount <= 0) return false;
  if (minion.divineShield) {
    minion.divineShield = false;
    minion.keywords = minion.keywords.filter((k) => k !== 'divineShield');
    log.push({ type: 'shield', side, uid: minion.uid });
    return false;
  }
  minion.health -= amount;
  log.push({ type: 'damage', side, uid: minion.uid, amount, health: minion.health });
  return minion.health <= 0;
}

// Убирает мёртвых, проигрывает предсмертные хрипы (призыв токенов на место смерти).
function resolveDeaths(board, side, log) {
  for (let i = 0; i < board.length; i++) {
    const m = board[i];
    if (m.health > 0) continue;
    log.push({ type: 'death', side, uid: m.uid });
    board.splice(i, 1);
    if (m.deathrattle) {
      const tokens = [];
      for (let k = 0; k < m.deathrattle.count; k++) {
        if (board.length + tokens.length >= 7) break;
        tokens.push(instantiate(m.deathrattle.summon));
      }
      board.splice(i, 0, ...tokens);
      for (const t of tokens) log.push({ type: 'summon', side, minion: t });
    }
    i--; // пересмотреть текущий индекс (сдвиг)
  }
}

// Один удар атакующего по случайной цели врага. Возвращает события через log.
function strike(atkSide, attacker, defBoard, defSide, log) {
  if (defBoard.length === 0) return;
  const di = pickDefenderIndex(defBoard, log._rng);
  const defender = defBoard[di];
  log.push({ type: 'attack', side: atkSide, attackerUid: attacker.uid, defenderUid: defender.uid });

  // Одновременный обмен уроном.
  dealDamage(defSide, di, defender, attacker.attack, log);
  dealDamage(atkSide, -1, attacker, defender.attack, log);
}

export function resolveCombat(boardA, boardB, tierA, tierB, seed) {
  const rng = makeRng(seed);
  const a = boardA.map(clone);
  const b = boardB.map(clone);
  const log = [];
  log._rng = rng;

  // Кто бьёт первым: у кого больше миньонов; ничья — случайно.
  let turn = a.length > b.length ? 'a'
    : b.length > a.length ? 'b'
    : (rng() < 0.5 ? 'a' : 'b');

  const ptr = { a: 0, b: 0 };
  let guard = 0;

  function nextAttacker(board, side) {
    if (board.length === 0) return -1;
    if (ptr[side] >= board.length) ptr[side] = 0;
    const idx = ptr[side];
    ptr[side] = (ptr[side] + 1) % Math.max(board.length, 1);
    return idx;
  }

  while (a.length > 0 && b.length > 0 && guard++ < 400) {
    const atkBoard = turn === 'a' ? a : b;
    const defBoard = turn === 'a' ? b : a;
    const defSide = turn === 'a' ? 'b' : 'a';

    const ai = nextAttacker(atkBoard, turn);
    if (ai === -1) break;
    const attacker = atkBoard[ai];

    // Пропускаем миньонов с 0 атаки (иначе зависание).
    if (attacker.attack > 0) {
      strike(turn, attacker, defBoard, defSide, log);
      resolveDeaths(defBoard, defSide, log);
      resolveDeaths(atkBoard, turn, log);

      // Вихрь: второй удар, если жив и есть кого бить.
      if (attacker.health > 0 && attacker.keywords.includes('windfury') && defBoard.length > 0) {
        strike(turn, attacker, defBoard, defSide, log);
        resolveDeaths(defBoard, defSide, log);
        resolveDeaths(atkBoard, turn, log);
      }
    }

    turn = turn === 'a' ? 'b' : 'a';
  }

  let winner, damage;
  if (a.length > 0 && b.length === 0) {
    winner = 'a';
    damage = tierA + a.reduce((s, m) => s + m.tier, 0);
  } else if (b.length > 0 && a.length === 0) {
    winner = 'b';
    damage = tierB + b.reduce((s, m) => s + m.tier, 0);
  } else {
    winner = 'draw';
    damage = 0;
  }

  log.push({ type: 'result', winner, damage });
  delete log._rng;
  return { winner, damage, log, survivors: { a: a.length, b: b.length } };
}
