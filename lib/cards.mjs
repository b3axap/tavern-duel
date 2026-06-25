// Пул миньонов. Чистые данные + хелперы. Без DOM, без зависимостей.
//
// keywords:
//   'taunt'        — провокация: должен быть выбран целью первым
//   'divineShield' — щит: поглощает первый урон
//   'windfury'     — вихрь: атакует дважды за свой ход
// deathrattle: { summon: 'tokenId', count: n } — предсмертный хрип, призыв токенов

export const CARDS = [
  // ── Тир 1 ───────────────────────────────────────────────
  { id: 'mouse',     name: 'Механо-мышь',      emoji: '🐭', tier: 1, attack: 1, health: 2, keywords: [] },
  { id: 'ratling',   name: 'Крысёныш',         emoji: '🐀', tier: 1, attack: 2, health: 1, keywords: [] },
  { id: 'shieldbug', name: 'Жук-щитоносец',    emoji: '🐞', tier: 1, attack: 1, health: 2, keywords: ['divineShield'] },
  { id: 'toad',      name: 'Жаба-тумба',       emoji: '🐸', tier: 1, attack: 1, health: 3, keywords: ['taunt'] },

  // ── Тир 2 ───────────────────────────────────────────────
  { id: 'wolf',      name: 'Быстроволк',       emoji: '🐺', tier: 2, attack: 2, health: 2, keywords: ['windfury'] },
  { id: 'turtle',    name: 'Железа-черепаха',  emoji: '🐢', tier: 2, attack: 1, health: 4, keywords: ['taunt'] },
  { id: 'imp',       name: 'Бес-искра',        emoji: '👺', tier: 2, attack: 3, health: 1, keywords: [] },
  { id: 'ghoul',     name: 'Упырь',            emoji: '🧟', tier: 2, attack: 2, health: 2, keywords: [], deathrattle: { summon: 'skeleton', count: 1 } },

  // ── Тир 3 ───────────────────────────────────────────────
  { id: 'knight',    name: 'Рыцарь',           emoji: '🛡️', tier: 3, attack: 3, health: 4, keywords: ['taunt'] },
  { id: 'assassin',  name: 'Ассасин',          emoji: '🗡️', tier: 3, attack: 4, health: 2, keywords: ['windfury'] },
  { id: 'paladin',   name: 'Паладин',          emoji: '✨', tier: 3, attack: 3, health: 3, keywords: ['divineShield'] },
  { id: 'necro',     name: 'Некромант',        emoji: '💀', tier: 3, attack: 2, health: 3, keywords: [], deathrattle: { summon: 'skeleton', count: 2 } },

  // ── Тир 4 ───────────────────────────────────────────────
  { id: 'golem',     name: 'Голем',            emoji: '🗿', tier: 4, attack: 5, health: 5, keywords: ['taunt'] },
  { id: 'drake',     name: 'Дракончик',        emoji: '🐉', tier: 4, attack: 4, health: 4, keywords: ['divineShield', 'windfury'] },

  // ── Тир 5 ───────────────────────────────────────────────
  { id: 'giant',     name: 'Великан',          emoji: '🏔️', tier: 5, attack: 6, health: 6, keywords: ['taunt'] },
  { id: 'reaper',    name: 'Жнец',             emoji: '⚰️', tier: 5, attack: 7, health: 4, keywords: ['windfury'] },

  // ── Тир 6 ───────────────────────────────────────────────
  { id: 'titan',     name: 'Титан',            emoji: '🌋', tier: 6, attack: 8, health: 8, keywords: ['taunt', 'divineShield'] },
  { id: 'phoenix',   name: 'Феникс',           emoji: '🔥', tier: 6, attack: 6, health: 6, keywords: [], deathrattle: { summon: 'chick', count: 1 } },
];

// Токены — не появляются в лавке, только из предсмертных хрипов.
export const TOKENS = {
  skeleton: { id: 'skeleton', name: 'Скелет',        emoji: '☠️', tier: 1, attack: 1, health: 1, keywords: [] },
  chick:    { id: 'chick',    name: 'Птенец феникса', emoji: '🐣', tier: 3, attack: 3, health: 3, keywords: [] },
};

const BY_ID = new Map([...CARDS, ...Object.values(TOKENS)].map((c) => [c.id, c]));

export function defById(id) {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Неизвестная карта: ${id}`);
  return d;
}

let _uid = 1;
export function resetUid(n = 1) { _uid = n; } // для детерминированных тестов

// Создаёт экземпляр миньона из определения (с уникальным uid).
export function instantiate(id) {
  const d = defById(id);
  return {
    uid: 'm' + _uid++,
    id: d.id,
    name: d.name,
    emoji: d.emoji,
    tier: d.tier,
    attack: d.attack,
    health: d.health,
    maxHealth: d.health,
    keywords: [...d.keywords],
    divineShield: d.keywords.includes('divineShield'),
    deathrattle: d.deathrattle ? { ...d.deathrattle } : null,
  };
}

// Размер лавки по тиру таверны.
export const SHOP_SIZE = [0, 3, 4, 4, 5, 5, 6];

// Стоимость апгрейда таверны до следующего тира (базовая, до скидок).
export const UPGRADE_COST = [0, 5, 7, 8, 9, 10, 0]; // индекс = текущий тир, ведём ко тиру+1

// Сэмпл лавки: shopSize случайных карт тира ≤ tavernTier.
export function rollShop(tavernTier, rng) {
  const eligible = CARDS.filter((c) => c.tier <= tavernTier);
  const size = SHOP_SIZE[tavernTier];
  const out = [];
  for (let i = 0; i < size; i++) {
    const pick = eligible[Math.floor(rng() * eligible.length)];
    out.push(instantiate(pick.id));
  }
  return out;
}
