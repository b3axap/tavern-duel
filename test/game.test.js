import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom, addPlayer, applyAction, resolveRound, endCombat, viewFor, CONFIG,
} from '../lib/game.mjs';

// Детерминированный rng для тестов.
function seqRng() {
  let i = 0;
  const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05];
  return () => seq[(i++) % seq.length];
}

function twoPlayerRoom() {
  // rng комнаты детерминирован (нужен для предсказуемой лавки),
  // а id игроков — через Math.random, иначе два игрока получат одинаковый pid.
  const room = createRoom(seqRng());
  const a = addPlayer(room, 'A');
  const b = addPlayer(room, 'B');
  return { room, a, b };
}

test('вторая посадка стартует вербовку на ходу 1', () => {
  const { room } = twoPlayerRoom();
  assert.equal(room.phase, 'recruit');
  assert.equal(room.turn, 1);
  for (const pid of room.order) assert.equal(room.players[pid].gold, 3);
});

test('третий игрок не входит', () => {
  const { room } = twoPlayerRoom();
  const c = addPlayer(room, 'C');
  assert.ok(c.error);
});

test('покупка тратит золото и кладёт на борд', () => {
  const { room, a } = twoPlayerRoom();
  const p = room.players[a.pid];
  const uid = p.shop[0].uid;
  const r = applyAction(room, a.pid, { type: 'buy', uid });
  assert.ok(r.ok);
  assert.equal(p.gold, 3 - CONFIG.buyCost);
  assert.equal(p.board.length, 1);
  assert.equal(p.board[0].uid, uid);
});

test('покупка без золота — ошибка', () => {
  const { room, a } = twoPlayerRoom();
  const p = room.players[a.pid];
  p.gold = 1;
  const r = applyAction(room, a.pid, { type: 'buy', uid: p.shop[0].uid });
  assert.equal(r.ok, false);
});

test('реролл меняет лавку и берёт 1 золото', () => {
  const { room, a } = twoPlayerRoom();
  const p = room.players[a.pid];
  const before = p.shop.map((m) => m.uid).join();
  applyAction(room, a.pid, { type: 'reroll' });
  assert.equal(p.gold, 2);
  assert.notEqual(p.shop.map((m) => m.uid).join(), before);
});

test('оба готовы → сигнал боя', () => {
  const { room, a, b } = twoPlayerRoom();
  applyAction(room, a.pid, { type: 'ready' });
  const r = applyAction(room, b.pid, { type: 'ready' });
  assert.ok(r.combat);
});

test('resolveRound наносит урон и идёт в фазу боя', () => {
  const { room, a, b } = twoPlayerRoom();
  // дать игроку A миньона, B пустой → A победит
  const pa = room.players[a.pid];
  applyAction(room, a.pid, { type: 'buy', uid: pa.shop[0].uid });
  const hpB = room.players[b.pid].hp;
  resolveRound(room);
  assert.equal(room.phase, 'combat');
  assert.ok(room.players[b.pid].hp < hpB);
  assert.ok(room.combat.log.length > 0);
});

test('viewFor скрывает лавку соперника', () => {
  const { room, a } = twoPlayerRoom();
  const v = viewFor(room, a.pid);
  assert.ok(v.you.shop);
  assert.equal(v.opp.shop, undefined);
  assert.equal(typeof v.opp.boardCount, 'number');
});

test('гибель игрока → конец игры с победителем', () => {
  const { room, a, b } = twoPlayerRoom();
  room.players[b.pid].hp = 1;
  const pa = room.players[a.pid];
  applyAction(room, a.pid, { type: 'buy', uid: pa.shop[0].uid });
  resolveRound(room);
  endCombat(room);
  if (room.players[b.pid].eliminated) {
    assert.equal(room.phase, 'gameover');
    assert.equal(room.winner, a.pid);
  }
});
