import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCombat, makeRng } from '../lib/combat.mjs';
import { instantiate, resetUid } from '../lib/cards.mjs';

test('пустые борды → ничья без урона', () => {
  const r = resolveCombat([], [], 1, 1, 123);
  assert.equal(r.winner, 'draw');
  assert.equal(r.damage, 0);
});

test('борд с миньоном бьёт пустой борд', () => {
  resetUid();
  const a = [instantiate('golem')]; // тир 4
  const r = resolveCombat(a, [], 3, 2, 1);
  assert.equal(r.winner, 'a');
  assert.equal(r.damage, 3 + 4); // tierA + сумма тиров выживших
});

test('щит поглощает первый удар', () => {
  resetUid();
  // паладин 3/3 со щитом против крысёныша 2/1
  const a = [instantiate('paladin')];
  const b = [instantiate('ratling')];
  const r = resolveCombat(a, b, 3, 1, 7);
  // паладин теряет щит (а не 2 хп), крысёныш дохнет → a побеждает
  assert.equal(r.winner, 'a');
  assert.ok(r.log.some((e) => e.type === 'shield'));
});

test('детерминизм: один сид → один и тот же лог', () => {
  resetUid(100);
  const a1 = [instantiate('wolf'), instantiate('imp')];
  const b1 = [instantiate('knight')];
  resetUid(100);
  const a2 = [instantiate('wolf'), instantiate('imp')];
  const b2 = [instantiate('knight')];
  const r1 = resolveCombat(a1, b1, 2, 3, 42);
  const r2 = resolveCombat(a2, b2, 2, 3, 42);
  assert.equal(r1.log.length, r2.log.length);
  assert.equal(r1.winner, r2.winner);
  assert.equal(r1.damage, r2.damage);
});

test('предсмертный хрип призывает токены', () => {
  resetUid();
  // некромант 2/3 (хрип: 2 скелета) против двух бесов 3/1
  const a = [instantiate('necro')];
  const b = [instantiate('imp'), instantiate('imp')];
  const r = resolveCombat(a, b, 3, 2, 5);
  assert.ok(r.log.some((e) => e.type === 'summon'));
});

test('rng детерминирован', () => {
  const r = makeRng(99);
  const a = [r(), r(), r()];
  const r2 = makeRng(99);
  assert.deepEqual(a, [r2(), r2(), r2()]);
});
