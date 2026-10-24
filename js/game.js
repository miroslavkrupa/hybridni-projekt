// Herní logika: stav hry, vyhodnocování rozhodnutí a vykreslování obrazovek.
'use strict';

const SPRINTS = 6;
const BASE_CAPACITY = 9;
const START_METRIC = 50;
// Rozpočet řídicí režie pro mix praktik; každý bod navíc stojí 1 SP kapacity za sprint.
const OVERHEAD_BUDGET = 8;
const MILESTONE_THRESHOLD = 45;
const MIX_INSIGHT_MAX = 80;
// Náročná úroveň (Hard): menší rozpočet režie, nižší start ukazatelů, dřívější konec projektu.
const HARD = { budget: 6, startMetric: 40, failAt: 10 };
const HARD_UNLOCK_SCORE = 70;
// Nemožná úroveň (Insane): pravidla bez nápověd, mlha reportingu, stakeholdeři, provoz, lidé a rok poté platí jen pro ni.
const INSANE = { budget: 6, startMetric: 40, failAt: 12 };
const INSANE_UNLOCK_SCORE = 70;
const LEVELS = { normal: { budget: OVERHEAD_BUDGET, startMetric: START_METRIC, failAt: 0 }, hard: HARD, insane: INSANE };
const STAKE_START = 50;
// Únava lidí (0–100): přírůstek za SP práce v oblasti, kterou umí, odpočinek za období, přetížení a přesčasy.
const FATIGUE = { perSP: 4, perSPShared: 2, rest: 10, restRetro: 14, overtime: 8, overload: 10, overloadKanban: 5, warn: 75, quit: 100 };
// Za každou oblast, kterou nikdo v týmu neumí, je práce o polovinu pracnější.
const UNKNOWN_AREA_FACTOR = 1.5;
const OPS_POINTS = 5;
const DIAG_POINTS = 5;
const TAKEOVER_ADD_COST = { rozpocet: -1, moralka: -1 };
// Změna kontextu: kolik praktik lze přidat a co každá stojí.
const MAX_SHIFT_ADDS = 2;
const SHIFT_ADD_COST = { rozpocet: -3, moralka: -2 };
// Každá hra vylosuje nejvýš tolik obecných událostí, zbytek do SPRINTS doplní události scénáře.
const GENERIC_EVENTS_PER_GAME = 3;
// S praktikou Hypotézy a experimenty lze za sprint levně ověřit hodnotu tolika položek.
const EXPERIMENTS_PER_SPRINT = 2;
const RATING_POINTS = { best: 10, ok: 4, bad: 0 };
const RATING_LABEL = { best: '✅ Výborná volba', ok: '⚠️ Přijatelná volba', bad: '❌ Špatná volba' };
const TRACK_LABEL = { pred: '📐 prediktivně řízené prvky', agile: '🔄 agilně řízené prvky', both: '🔗 propojení obou přístupů' };
const PATTERN_TYPE = { pattern: '🟢 Vzorec', anti: '🔴 Antivzorec' };
const ALL_APPROACHES = ['hybrid', 'pred', 'agile'];
const RECORD_KEY = 'hybridni-projekt-rekord-';
const ATLAS_KEY = 'hybridni-projekt-atlas';

// Tvary slov pro období projektu (sprint v agilním a hybridním, etapa v prediktivním).
const PERIODS = {
  Sprint: { nom: 'Sprint', gen: 'sprintu', acc: 'sprint', few: 'sprinty', many: 'sprintů', next: 'příštího sprintu', review: 'Sprint review', toReview: 'sprint review' },
  Etapa: { nom: 'Etapa', gen: 'etapy', acc: 'etapu', few: 'etapy', many: 'etap', next: 'příští etapy', review: 'Kontrola etapy', toReview: 'kontrolu etapy' },
};

const TIMELINE_LABELS = {
  hybrid: [['📐 Prediktivní prvky', 'fáze a milníky'], ['🔄 Agilní prvky', 'sprinty']],
  pred: [['📐 Milníky', 'konec každé etapy'], ['🧱 Etapy', 'plán po vlnách']],
  agile: [['🎯 Cíle trakce', 'hodnota pro uživatele'], ['🔄 Sprinty', 'po 2 týdnech']],
};

const app = document.getElementById('app');
let S;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clamp = v => Math.max(0, Math.min(100, v));
const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const metricById = id => METRICS.find(m => m.id === id);
const practiceById = id => PRACTICES.find(p => p.id === id);
const appliesTo = (item, approach) => (item.approaches || ALL_APPROACHES).includes(approach);

function addEffects(...list) {
  const out = {};
  for (const e of list) for (const [k, v] of Object.entries(e || {})) out[k] = (out[k] || 0) + v;
  return out;
}

// Dosadí výrazy scénáře za {klíč}. Text začínající zástupným symbolem dostane velké písmeno.
function localize(v, terms) {
  if (typeof v === 'string') {
    if (!v.includes('{')) return v;
    const s = v.replace(/\{(\w+)\}/g, (m, k) => terms[k] ?? m);
    return v.startsWith('{') ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  if (Array.isArray(v)) return v.map(x => localize(x, terms));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x, terms)]));
  return v;
}

// Připraví rozhodnutí pro hru: dosadí texty a zamíchá pořadí odpovědí.
function prepDecision(item, terms) {
  const d = localize(item, terms);
  d.choices = shuffle(d.choices);
  return d;
}

// ---------- Trvalé úložiště (rekordy, atlas) ----------

function getRecord(id) {
  try { return +localStorage.getItem(RECORD_KEY + id) || 0; } catch { return 0; }
}

function setRecord(id, score) {
  try { localStorage.setItem(RECORD_KEY + id, String(score)); } catch { /* bez úložiště se rekord neuloží */ }
}

function getAtlas() {
  try { return JSON.parse(localStorage.getItem(ATLAS_KEY)) || []; } catch { return []; }
}

function addToAtlas(id) {
  const atlas = getAtlas();
  if (atlas.includes(id)) return;
  atlas.push(id);
  try { localStorage.setItem(ATLAS_KEY, JSON.stringify(atlas)); } catch { /* atlas se neuloží */ }
}

// ---------- Nová hra ----------

function newGame() {
  S = { screen: 'intro', sc: null, modal: null };
  render();
}

const scPeriods = sc => (sc.phases ? sc.phases.length : sc.sprints ?? SPRINTS);

// Události: buď pevné pořadí slotů (v každém se vylosuje jedna z možností), nebo zamíchané události scénáře a obecné.
function drawEvents(sc) {
  if (sc.eventSlots) return sc.eventSlots.map(pool => prepDecision(pool[Math.floor(Math.random() * pool.length)], sc.terms));
  const generic = shuffle(GENERIC_EVENTS.filter(e => appliesTo(e, sc.approach)));
  const nGeneric = Math.min(GENERIC_EVENTS_PER_GAME, generic.length);
  return shuffle([
    ...shuffle(sc.events).slice(0, scPeriods(sc) - nGeneric),
    ...generic.slice(0, nGeneric),
  ]).map(e => prepDecision(e, sc.terms));
}

function startScenario(id) {
  const sc = SCENARIOS.find(s => s.id === id);
  const lv = LEVELS[sc.level || 'normal'];
  const metrics = Object.fromEntries(METRICS.map(m => [m.id, sc.startMetrics?.[m.id] ?? lv.startMetric]));
  S = {
    screen: 'brief',
    sc,
    approach: sc.approach,
    targetValue: sc.targetValue ?? (sum((sc.backlog || []).filter(b => b.moscow === 'M' || b.moscow === 'S'), b => b.value) || 1),
    metrics,
    reportHistory: [{ ...metrics }],
    stake: Object.fromEntries((sc.stakeholders || []).filter(s => !s.joins).map(s => [s.id, s.start ?? STAKE_START])),
    team: (sc.team || []).map(p => ({ ...p, knows: p.knows.slice(), fatigue: p.fatigue ?? 20, gone: false })),
    teamLoss: 0,
    opsOverhead: 0,
    handedOver: [],
    diag: sc.takeover ? { picks: [], result: null, symptoms: shuffle(sc.takeover.symptoms) } : null,
    extraContext: [],
    shiftsDone: [],
    shiftCur: null,
    shiftPenalty: null,
    shiftDelay: 0,
    epilog: null,
    closed: false,
    insight: 0,
    insightMax: 0,
    lessons: [],
    sortOrder: shuffle(sc.workstreams || []),
    sortAnswers: {},
    sortResult: null,
    mix: sc.takeover ? sc.takeover.mix.slice() : [],
    mixCost: 0,
    mixResult: null,
    overloads: 0,
    found: [],
    sprint: 1,
    backlog: (sc.backlog || []).map(b => ({ ...b, done: false })),
    selected: [],
    verified: [],
    experiments: 0,
    valueDelivered: 0,
    buffer: 0,
    initialBuffer: 0,
    gantt: null,
    phaseRun: null,
    phaseDelay: 0,
    phaseResults: [],
    overrunTotal: 0,
    carryIn: [],
    hiddenRevealed: false,
    shiftAdapted: null,
    shiftCapacity: 0,
    reshape: null,
    shiftResult: null,
    echoes: { good: 0, bad: 0 },
    aftermath: [],
    aftermathApplied: false,
    capacityMod: 0,
    events: drawEvents(sc),
    gate: prepDecision(sc.gate || GATE_EVENT, sc.terms),
    current: null,
    review: null,
    milestones: {},
    depUnlock: 3,
    gateDone: false,
    failed: null,
    prevRecord: null,
    modal: null,
  };
  // Převzatý projekt už nějaký mix praktik má.
  S.mixCost = currentMixCost();
}

// ---------- Typ projektu a úroveň ----------

// Typ projektu se může během hry změnit (projekt, který mění tvář).
const AP = () => S.approach;
const level = () => S.sc.level || 'normal';
const isHard = () => level() === 'hard';
const isInsane = () => level() === 'insane';
const budget = () => LEVELS[level()].budget;
const failAt = () => LEVELS[level()].failAt;
const expPerSprint = () => S.sc.experimentsPerSprint ?? EXPERIMENTS_PER_SPRINT;
// Kontext, který hráč zná: skrytý faktor a nové okolnosti se přidají až po změně kontextu.
const visibleContext = () => [
  ...S.sc.context,
  ...(S.hiddenRevealed && S.sc.hiddenContext ? [S.sc.hiddenContext] : []),
  ...S.extraContext,
];

const urlFlag = name => new RegExp(`[?&]${name}\\b`).test(location.search);

function hardUnlocked() {
  if (urlFlag('hard') || urlFlag('insane')) return true;
  return SCENARIOS.some(sc => !sc.level && getRecord(sc.id) >= HARD_UNLOCK_SCORE);
}

function insaneUnlocked() {
  if (urlFlag('insane')) return true;
  return SCENARIOS.some(sc => sc.level === 'hard' && getRecord(sc.id) >= INSANE_UNLOCK_SCORE);
}

function levelUnlocked(lv) {
  return lv === 'hard' ? hardUnlocked() : lv === 'insane' ? insaneUnlocked() : true;
}

// Pravidla nemožné úrovně: bez nápověd (1) a mlha reportingu (2), dokud v mixu není dashboard nebo EVM.
const hints = () => !isInsane();
const fogged = () => isInsane() && !has('dashboard') && !has('evm');

// V mlze přicházejí aspoň neformální signály, když je některý ukazatel opravdu nízko.
const FOG_SIGNALS = {
  rozpocet: '💬 Finanční oddělení se začíná vyptávat na každou fakturu.',
  harmonogram: '💬 Na chodbě se šušká, že termín je nereálný.',
  kvalita: '💬 Testeři si stěžují na čím dál víc chyb.',
  spokojenost: '💬 Zadavatel přestal odpovídat na e-maily.',
  moralka: '💬 Lidé v týmu si potichu aktualizují životopisy.',
};
const fogSignals = () => (fogged() ? METRICS.filter(m => S.metrics[m.id] < 25).map(m => FOG_SIGNALS[m.id]) : []);
const per = () => PERIODS[APPROACHES[AP()].period];

// ---------- Nemožná úroveň: stakeholdeři (3) ----------

const stakeholderById = id => S.sc.stakeholders.find(s => s.id === id);

function applyStake(changes = {}) {
  const deltas = {};
  for (const [k, v] of Object.entries(changes)) {
    if (!(k in S.stake)) continue;
    const before = S.stake[k];
    S.stake[k] = clamp(before + v);
    deltas[k] = S.stake[k] - before;
  }
  return deltas;
}

const stakeMin = () => (Object.keys(S.stake).length ? Math.min(...Object.values(S.stake)) : null);

// ---------- Nemožná úroveň: lidé a znalosti (5) ----------

const present = () => S.team.filter(p => !p.gone);
const knowers = area => present().filter(p => p.knows.includes(area));
const areaLabel = a => `${S.sc.areas[a].icon} ${S.sc.areas[a].label}`;
const vf = (p, m, f) => (p.f ? f : m);
// Práce v oblasti, kterou v týmu nikdo neumí, je pracnější – někdo se ji musí naučit za pochodu.
const itemSP = it => (it.area && S.team.length && !knowers(it.area).length ? Math.ceil(it.sp * UNKNOWN_AREA_FACTOR) : it.sp);

function leavePerson(p, reason) {
  if (p.gone) return [];
  p.gone = true;
  S.teamLoss++;
  const lost = p.knows.filter(a => !knowers(a).length);
  applyEffects({ moralka: -4 });
  return [`🚪 ${p.name} ${reason}.${lost.length ? ` Nikdo jiný neumí: ${lost.map(areaLabel).join(', ')} – práce v ${lost.length > 1 ? 'těchto oblastech' : 'této oblasti'} bude o polovinu pracnější.` : ''}`];
}

// Sdílení znalostí: oblast, kterou umí jen jeden člověk, se naučí ten nejméně unavený z ostatních.
function teach(area) {
  const ks = knowers(area);
  const learner = present().filter(p => !p.knows.includes(area)).sort((a, b) => a.fatigue - b.fatigue)[0];
  if (!learner) return null;
  learner.knows.push(area);
  return `🧠 ${learner.name} ${vf(learner, 'se naučil', 'se naučila')}: ${areaLabel(area)}${ks.length ? ` (učí ${ks.map(p => p.name).join(' a ')})` : ''}.`;
}

// Změny týmu z rozhodnutí a změn kontextu: { leave, fatigue: { id | all: n }, teach: area, join: [osoby] }.
function applyTeam(t) {
  if (!t || !S.team.length) return [];
  const notes = [];
  for (const [id, n] of Object.entries(t.fatigue || {})) {
    for (const p of id === 'all' ? present() : present().filter(x => x.id === id)) p.fatigue = clamp(p.fatigue + n);
  }
  for (const id of [].concat(t.leave || [])) {
    const p = S.team.find(x => x.id === id);
    if (p) notes.push(...leavePerson(p, t.reason || 'odchází z projektu'));
  }
  for (const p of t.join || []) {
    S.team.push({ ...p, knows: p.knows.slice(), fatigue: p.fatigue ?? 10, gone: false });
    notes.push(`👋 Do týmu ${vf(p, 'přišel', 'přišla')} ${p.name} (${p.role}).`);
  }
  if (t.teach) { const n = teach(t.teach); if (n) notes.push(n); }
  return notes;
}

// Únava po období: práce ve vlastní oblasti, přesčasy, přetížení, odpočinek a sdílení znalostí.
function teamAfterPeriod(items, overloaded) {
  if (!S.team.length) return [];
  const notes = [];
  const load = {};
  for (const it of items) {
    const ks = it.area ? knowers(it.area) : [];
    const who = ks.length ? ks : present();
    const per = (ks.length ? FATIGUE.perSP : FATIGUE.perSPShared) * it.sp / who.length;
    for (const p of who) load[p.id] = (load[p.id] || 0) + per;
  }
  const base = (has('prescasy') ? FATIGUE.overtime : 0)
    + (overloaded ? (has('kanban') ? FATIGUE.overloadKanban : FATIGUE.overload) : 0)
    - (has('retro') ? FATIGUE.restRetro : FATIGUE.rest);
  for (const p of present()) p.fatigue = clamp(Math.round(p.fatigue + (load[p.id] || 0) + base));
  if (has('znalosti')) {
    const single = Object.keys(S.sc.areas).find(a => knowers(a).length === 1);
    const n = single && teach(single);
    if (n) notes.push(n);
  }
  for (const p of present()) {
    if (p.fatigue >= FATIGUE.quit) notes.push(...leavePerson(p, `${vf(p, 'vyhořel', 'vyhořela')} a odchází`));
    else if (p.fatigue >= FATIGUE.warn) notes.push(`🥵 ${p.name} je na hraně sil.`);
  }
  return notes;
}

// ---------- Praktiky a vzorce ----------

const has = id => S.mix.includes(id);
const chosenPractices = () => S.mix.map(practiceById);
const currentMixCost = () => sum(chosenPractices(), p => p.cost);
const activePairs = () => PRACTICE_PAIRS.filter(x => has(x.a) && has(x.b));
const isTrap = p => (p.trapIn || []).includes(AP());
const isMisfit = p => !isTrap(p) && p.useIn && !p.useIn.includes(AP());
const hasPlanning = () => chosenPractices().some(p => p.planning);

function patternCtx() {
  return { has, approach: AP(), cost: S.mixCost, budget: budget(), overloads: S.overloads,
    adapted: S.shiftAdapted, goodEchoes: S.echoes.good, badEchoes: S.echoes.bad };
}

const isFound = id => S.found.some(f => f.id === id);
const activePatterns = () => PATTERNS.filter(p => appliesTo(p, AP()) && p.when(patternCtx()));

// Odhalí vzorce, které v této hře vznikly a jejichž chvíle právě nastala.
function revealPatterns(trigger) {
  const out = [];
  for (const p of activePatterns()) {
    if (isFound(p.id)) continue;
    const due = typeof p.reveal === 'number' ? trigger === 'sprint' && S.sprint >= Math.min(p.reveal, periods()) : p.reveal === trigger;
    if (!due) continue;
    const deltas = applyEffects(p.once);
    S.found.push({ id: p.id, sprint: S.sprint });
    addToAtlas(p.id);
    out.push({ p, deltas });
  }
  return out;
}

function practiceCapacity() {
  return sum(chosenPractices(), p => p.capacity || 0) - Math.max(0, S.mixCost - budget());
}

function milestoneThreshold() {
  let t = hasPlanning() ? MILESTONE_THRESHOLD : MILESTONE_THRESHOLD + 10;
  if (has('sync') && has('integrace')) t -= 10;
  return t;
}

// Zmírní negativní dopady události podle zvolených praktik.
function softenEffects(effects, track) {
  const out = { ...effects };
  const by = [];
  for (const p of chosenPractices()) {
    const s = p.softens;
    if (!s) continue;
    if (s.track && s.track !== track) continue;
    let changed = false;
    for (const [k, v] of Object.entries(out)) {
      if (v >= 0 || (s.metrics && !s.metrics.includes(k))) continue;
      out[k] = Math.round(v * s.factor);
      changed = changed || out[k] !== v;
    }
    if (changed) by.push(p);
  }
  return { effects: out, by };
}

// ---------- Mechaniky ----------

function applyEffects(effects = {}) {
  const deltas = {};
  for (const [k, v] of Object.entries(effects)) {
    if (!(k in S.metrics)) continue;
    const before = S.metrics[k];
    S.metrics[k] = clamp(before + v);
    deltas[k] = (deltas[k] || 0) + S.metrics[k] - before;
  }
  return deltas;
}

function recordDecision(title, choice, lesson) {
  S.insight += RATING_POINTS[choice.rating];
  S.insightMax += RATING_POINTS.best;
  S.lessons.push({ title, rating: choice.rating, choice: choice.text, lesson });
}

function checkFail() {
  const m = S.metrics;
  const f = failAt();
  if (S.failed) { /* projekt už skončil (např. zmeškaný start) */ }
  else if (m.rozpocet <= f) S.failed = 'Rozpočet je vyčerpaný. Sponzor projekt zastavil.';
  else if (m.spokojenost <= f) S.failed = 'Řídicí výbor ztratil důvěru a odvolal tě z projektu.';
  else if (m.moralka <= f) S.failed = 'Tým se rozpadl – většina lidí odešla.';
  else if (m.harmonogram <= f) S.failed = 'Projekt se zpozdil natolik, že ho vedení zrušilo.';
  else {
    const lost = Object.entries(S.stake).find(([, v]) => v <= f);
    if (lost) { const s = stakeholderById(lost[0]); S.failed = `${s.icon} ${s.name}: ${s.quit}`; }
  }
  if (S.failed) { closeProject(); S.screen = 'end'; }
  return !!S.failed;
}

const baseCapacity = () => S.sc.baseCapacity ?? BASE_CAPACITY;
const moraleCapacity = () => Math.floor((S.metrics.moralka - 50) / 10);

function capacity() {
  // Kapacita nesmí klesnout pod největší položky backlogu (5 SP), jinak by nešly nikdy dokončit.
  return Math.max(5, baseCapacity() + moraleCapacity() + practiceCapacity() + S.capacityMod + S.shiftCapacity - S.teamLoss - S.opsOverhead);
}

// Skutečná hodnota položky (v agilním scénáři se liší od odhadu).
const itemValue = it => it.actual ?? it.value;
const valueKnown = it => it.actual === undefined || it.done || S.verified.includes(it.id);

function itemLock(item) {
  if (item.done) return 'Hotovo';
  if (item.needsMilestone && S.sprint < S.depUnlock) {
    return `${S.sc.dependency.lock} – dostupné od ${per().gen} ${S.depUnlock}`;
  }
  const missing = (item.requires || []).filter(id => !S.backlog.find(b => b.id === id)?.done);
  if (missing.length) {
    const name = id => (S.backlog.find(b => b.id === id) || S.sc.backlog.find(b => b.id === id) || { name: id }).name;
    return 'Nejdřív musí být hotové: ' + missing.map(name).join(', ');
  }
  return null;
}

function selectedSP() {
  return sum(S.selected, id => itemSP(S.backlog.find(b => b.id === id)));
}

function addItems(items) {
  const added = [];
  for (const it of items || []) {
    if (S.backlog.some(b => b.id === it.id)) continue;
    S.backlog.push({ ...it, done: false });
    added.push(it);
  }
  return added;
}

// Průběžné působení mixu praktik a vzorců (i těch, které hráč ještě neodhalil).
function applyOngoing() {
  const sources = [
    ...chosenPractices().filter(p => p.perSprint).map(p => ({ label: `${p.icon} ${p.name}`, e: p.perSprint })),
    ...activePatterns().filter(p => p.perSprint).map(p => ({
      label: isFound(p.id) ? `${p.icon} ${p.name}` : '❓ neodhalený vliv', e: p.perSprint,
    })),
  ];
  if (S.shiftPenalty) sources.push({ label: '🧱 Strnulá metodika', e: S.shiftPenalty });
  if (!sources.length) return null;
  return { labels: sources.map(x => x.label), deltas: applyEffects(addEffects(...sources.map(x => x.e))) };
}

function runSprint() {
  const cap = capacity();
  S.capacityMod = 0;
  const items = S.selected.map(id => S.backlog.find(b => b.id === id));
  const committed = sum(items, itemSP);
  const delivered = [];
  const unfinished = [];
  let used = 0;
  for (const it of items) {
    if (!unfinished.length && used + itemSP(it) <= cap) {
      used += itemSP(it);
      it.done = true;
      delivered.push(it);
    } else {
      unfinished.push(it);
    }
  }
  const value = sum(delivered, itemValue);
  S.valueDelivered += value;
  const feedback = AP() === 'pred' || chosenPractices().some(p => p.feedbackLoop);
  const notes = [];
  const effects = { spokojenost: Math.round(value / (feedback ? 6 : 12)) };
  if (unfinished.length) {
    S.overloads++;
    effects.moralka = has('kanban') ? practiceById('kanban').overloadMorale : -8;
    effects.kvalita = -4;
    effects.spokojenost -= 4;
    notes.push('Tým se zavázal k víc práci, než zvládne. Nedokončené položky se vrací zpět, lidé jsou vyčerpaní a sliby nesplněné.');
  }
  const anyAvailable = S.backlog.some(b => !itemLock(b));
  if (committed < cap * 0.6 && anyAvailable) {
    effects.spokojenost -= 3;
    notes.push('Tým nevyužil velkou část kapacity, i když byla dostupná práce.');
  }
  if (value) {
    const tail = AP() === 'pred' ? '' : feedback ? ' Přírůstek si vyzkoušeli na review.' : ' Bez review ji ale uživatelé skoro nevidí.';
    notes.unshift(`Dodaná hodnota: +${value}.${tail}`);
  }
  if (S.sc.burn) {
    const revenue = Math.round(value / (S.sc.revenueDiv || 5));
    effects.rozpocet = (effects.rozpocet || 0) - S.sc.burn + revenue;
    notes.push(`💸 Provoz týmu stál ${S.sc.burn}, tržby z nové verze přinesly ${revenue}.`);
  }
  const deltas = applyEffects(effects);

  // Stakeholdeři: každý sleduje hlavně „své“ položky. Kdo dlouho nic nedostane, ztrácí trpělivost.
  const stakeChange = {};
  for (const id of Object.keys(S.stake)) {
    const val = sum(delivered.filter(it => it.owner === id), itemValue);
    const waiting = S.backlog.some(b => !b.done && b.owner === id && !b.ops && b.moscow !== 'W');
    stakeChange[id] = val ? Math.round(val / 3) : waiting ? -3 : 0;
  }
  const stakeDeltas = applyStake(stakeChange);

  // Dodané funkce mohou odhalit nové podněty od uživatelů.
  const discovered = addItems(delivered.flatMap(it => (it.reveals || []).map(id => (S.sc.discoveries || []).find(d => d.id === id)).filter(Boolean)));

  const ongoing = applyOngoing();
  const teamNotes = teamAfterPeriod(items, unfinished.length > 0);

  S.review = {
    cap, committed, experiments: S.experiments, delivered, unfinished, value, notes, deltas, stakeDeltas, teamNotes,
    discovered, ongoing, milestone: null, reveals: [], signals: fogSignals(),
  };
  S.selected = [];
  S.experiments = 0;
}

function checkMilestone() {
  const ms = S.sc.milestones.find(m => m.afterSprint === S.sprint);
  if (!ms) return null;
  let ok, text, effects = {};
  if (ms.kind === 'launch') {
    const missing = S.backlog.filter(b => b.moscow === 'M' && !b.done);
    ok = missing.length === 0;
    text = ok ? ms.okText : `${ms.lateText} ${missing.map(b => b.name).join(', ')}.`;
    if (!ok) effects = { spokojenost: -4 * missing.length };
    if (!ok && ms.fatal) S.failed = ms.failText;
  } else if (ms.kind === 'integration') {
    const missing = ms.requires.filter(id => !S.backlog.find(b => b.id === id)?.done);
    ok = !missing.length;
    text = ok ? ms.okText : `${ms.lateText} Chybí: ${missing.map(id => S.backlog.find(b => b.id === id)?.name || id).join(', ')}.`;
    if (!ok) effects = { kvalita: -8, spokojenost: -6 };
  } else if (ms.kind === 'traction') {
    ok = S.valueDelivered >= ms.target;
    text = `${ok ? ms.okText : ms.lateText} (Skutečná hodnota pro uživatele: ${S.valueDelivered}, cíl ${ms.target}.)`;
    if (!ok) effects = { spokojenost: ms.afterSprint === periods() ? -10 : -6 };
  } else {
    const threshold = milestoneThreshold();
    ok = S.metrics.harmonogram >= threshold;
    text = ok ? ms.okText : `${ms.lateText}${fogged() ? '' : ` (Harmonogram ${S.metrics.harmonogram}, potřeba ≥ ${threshold}.)`}`;
    if (!ok && ms.kind === 'dependency') { S.depUnlock = 4; effects = { spokojenost: -6 }; }
    if (!ok && ms.kind === 'schedule') effects = { spokojenost: -8, rozpocet: -5 };
  }
  const deltas = applyEffects(effects);
  S.milestones[ms.id] = ok ? 'ok' : 'late';
  return { ...ms, ok, text, deltas };
}

const MIX_LESSON = {
  hybrid: 'Dobrý hybridní mix pokryje plán a rizika prediktivně řízených prvků, iterace a Product Ownera u agilně řízených prvků a hlavně jejich propojení v jednom projektu – bez zbytečné režie.',
  pred: 'V prediktivním projektu se vyplatí detailní plán s kritickou cestou, řízení změn a rizik a přesné měření stavu. Agilní ceremonie by tu byly jen režií.',
  agile: 'V agilním projektu se vyplatí iterace, Product Owner, ověřování hypotéz a průběžné zlepšování. Detailní plán by stál na neověřených předpokladech.',
};

// Vyhodnotí mix praktik: jednorázové efekty, soulad s kontextem a manažerský úsudek.
function evaluateMix() {
  S.mixCost = currentMixCost();
  const chosen = chosenPractices();
  // Převzatý projekt: jednorázově působí jen nově zavedené praktiky; zavedení stojí, zrušení škodlivých uleví.
  const to = S.sc.takeover;
  const fresh = to ? chosen.filter(p => !to.mix.includes(p.id)) : chosen;
  const removed = to ? to.mix.filter(id => !has(id)) : [];
  const fits = fresh.flatMap(p => (p.fits || []).filter(t => visibleContext().includes(t)).map(t => ({ p, t })));
  const deltas = applyEffects(addEffects(
    ...fresh.map(p => p.effects), ...fits.map(() => CONTEXT_FIT_EFFECTS),
    ...(to ? fresh.map(() => TAKEOVER_ADD_COST) : []), ...removed.map(id => (to.removeBonus || {})[id]),
  ));
  const essentials = ESSENTIALS[AP()].map(e => ({ ...e, ok: e.any.some(has) }));
  const traps = chosen.filter(isTrap);
  const misfits = chosen.filter(isMisfit);
  const costOk = S.mixCost >= Math.min(4, budget() - 2) && S.mixCost <= budget() + 1;
  if (AP() === 'pred') S.buffer = S.initialBuffer = (S.sc.buffer || 0) + sum(chosen, p => p.bufferBonus || 0);

  // Mix je klíčové rozhodnutí hry, proto váží víc než jednotlivá událost.
  const perEssential = Math.floor((MIX_INSIGHT_MAX - 8) / essentials.length);
  let points = perEssential * essentials.filter(e => e.ok).length + (traps.length || misfits.length ? 0 : 8)
    - 15 * traps.length - 8 * misfits.length - (costOk ? 0 : 15);
  points = Math.max(0, Math.min(MIX_INSIGHT_MAX, points));
  S.insight += points;
  S.insightMax += MIX_INSIGHT_MAX;
  S.lessons.push({
    title: to ? 'Zásah do mixu praktik' : 'Mix praktik',
    rating: points >= 64 ? 'best' : points >= 40 ? 'ok' : 'bad',
    choice: (chosen.map(p => p.icon).join(' ') || 'žádné praktiky') + (hints() ? '' : ` · chyběly základy: ${essentials.filter(e => !e.ok).map(e => e.name.toLowerCase()).join(', ') || 'žádné'}${traps.length ? ` · pasti: ${traps.map(p => p.name).join(', ')}` : ''}`),
    lesson: to ? to.lesson : MIX_LESSON[AP()],
  });
  S.mixResult = { deltas, fits, essentials, traps, misfits, pairs: activePairs(), fresh, removed };
}

// ---------- Prediktivní projekt: etapy, Gantt a plánování po vlnách ----------

const isPhased = () => !!S.sc.phases;
const periods = () => scPeriods(S.sc);
const gateAfter = () => S.sc.gateAfter ?? 4;
const phase = () => S.sc.phases[S.sprint - 1];
const taskMD = t => t.days * t.people;
const taskSkill = t => t.skill || 'lide';
const phaseMD = ph => sum(ph.tasks, taskMD);
const taskEnd = (start, t) => start + t.days - 1;
const byTaskId = tasks => Object.fromEntries(tasks.map(t => [t.id, t]));
// Úkoly aktuální etapy včetně práce přesunuté z minulé výluky.
const phaseTasks = () => [...S.carryIn, ...phase().tasks];
const GANTT_EXTRA_DAYS = 5;
const GANTT_LESSON = 'Dobrý Gantt má správné závislosti, respektuje kapacitu lidí a vejde se do délky etapy – ideálně s malou vůlí na neočekávané.';

function initGantt() {
  const tasks = phaseTasks();
  S.gantt = {
    starts: Object.fromEntries(tasks.map(t => [t.id, 1])),
    deps: Object.fromEntries(tasks.map(t => [t.id, []])),
  };
  // Neupravená metodika po změně kontextu (Hard) zdržuje každou etapu.
  S.phaseDelay = S.shiftDelay;
}

// Lidé každé profese na den: základ etapy upravený morálkou, mixem praktik a událostmi.
function crews() {
  const ph = phase();
  const base = typeof ph.crew === 'number' ? { lide: ph.crew } : ph.crew;
  const mod = Math.trunc((practiceCapacity() + moraleCapacity() + S.capacityMod + S.shiftCapacity) / 2);
  // Každá profese má vždy aspoň tolik lidí, kolik potřebuje její největší úkol – jinak by úkol nikdy nezačal.
  const need = k => Math.max(1, ...phaseTasks().filter(t => taskSkill(t) === k).map(t => t.people));
  return Object.fromEntries(Object.entries(base).map(([k, n]) => [k, Math.max(need(k), n - 2, n + mod)]));
}

// Kolik lidí (dané profese) je potřeba v jednotlivých dnech; extra = dny navíc u úkolu (opravy).
function usage(tasks, startOf, extra = {}, skill = null) {
  const out = [];
  for (const t of tasks) {
    if (skill && taskSkill(t) !== skill) continue;
    const s = startOf(t);
    for (let d = s; d < s + t.days + (extra[t.id] || 0); d++) out[d] = (out[d] || 0) + t.people;
  }
  return out;
}

// Počet dní, kdy některá profese nestačí.
function overloadDays(tasks, startOf, crew) {
  const days = new Set();
  for (const k of Object.keys(crew)) usage(tasks, startOf, {}, k).forEach((u, d) => { if (u > crew[k]) days.add(d); });
  return days.size;
}

// Úkoly, které začínají dřív, než skončí některý jejich předchůdce.
function depConflicts(tasks, starts, depsOf) {
  const byId = byTaskId(tasks);
  return tasks.filter(t => depsOf(t).some(d => byId[d] && starts[t.id] <= taskEnd(starts[d], byId[d])));
}

// Úkoly naplánované dřív, než přijede inspektor nebo zkušebna.
const holdConflicts = (tasks, starts) => tasks.filter(t => t.holdDay && starts[t.id] < t.holdDay);

// Nejdřívější začátky podle vyznačených závislostí a inspekčních dnů (bez ohledu na kapacitu).
function earliestStarts(tasks, deps) {
  const byId = byTaskId(tasks);
  const es = Object.fromEntries(tasks.map(t => [t.id, 1]));
  for (let i = 0; i <= tasks.length; i++) {
    for (const t of tasks) es[t.id] = Math.max(1, t.holdDay || 1, ...deps[t.id].filter(d => byId[d]).map(d => es[d] + byId[d].days));
  }
  return es;
}

// Kritická cesta a vůle úkolů podle vyznačených závislostí.
function criticalInfo(tasks, deps) {
  const es = earliestStarts(tasks, deps);
  const end = Math.max(...tasks.map(t => taskEnd(es[t.id], t)));
  const ls = Object.fromEntries(tasks.map(t => [t.id, end - t.days + 1]));
  for (let i = 0; i <= tasks.length; i++) {
    for (const t of tasks) {
      const succ = tasks.filter(x => deps[x.id].includes(t.id));
      const lf = succ.length ? Math.min(...succ.map(x => ls[x.id])) - 1 : end;
      ls[t.id] = lf - t.days + 1;
    }
  }
  const float = Object.fromEntries(tasks.map(t => [t.id, Math.max(0, ls[t.id] - es[t.id])]));
  return { end, float, critical: new Set(tasks.filter(t => float[t.id] === 0).map(t => t.id)) };
}

// Posouzení plánu: vůči vyznačeným (viditelné) i skutečným závislostem (skryté do konce etapy).
function evaluateGantt() {
  const tasks = phaseTasks();
  const g = S.gantt;
  const crew = crews();
  return {
    crew,
    finish: Math.max(...tasks.map(t => taskEnd(g.starts[t.id], t))),
    declaredConflicts: depConflicts(tasks, g.starts, t => g.deps[t.id]),
    trueConflicts: depConflicts(tasks, g.starts, t => t.deps),
    holdConflicts: holdConflicts(tasks, g.starts),
    missed: tasks.flatMap(t => t.deps.filter(d => !g.deps[t.id].includes(d)).map(d => [d, t.id])),
    extra: tasks.flatMap(t => g.deps[t.id].filter(d => !t.deps.includes(d)).map(d => [d, t.id])),
    overDays: overloadDays(tasks, t => g.starts[t.id], crew),
  };
}

// Přehraje etapu den po dni podle skutečných závislostí a skutečné velikosti týmu:
// úkol začne nejdřív v plánovaný den (a ne před inspekcí), až skončí jeho předchůdci
// a jsou volní lidé dané profese. Konflikt se skutečnou závislostí = přerušení a den navíc.
function simulatePhase() {
  const run = S.phaseRun;
  const tasks = run.tasks;
  const crew = run.plan.crew;
  const conflictIds = new Set(run.plan.trueConflicts.map(t => t.id));
  const actual = {};
  const use = Object.fromEntries(Object.keys(crew).map(k => [k, []]));
  const pending = tasks.slice().sort((a, b) => run.starts[a.id] - run.starts[b.id] || a.id.localeCompare(b.id));
  for (let day = 1; pending.length && day < 200; day++) {
    for (const t of pending.slice()) {
      if (day < run.starts[t.id] || day < (t.holdDay || 1)) continue;
      if (!t.deps.every(d => actual[d] && actual[d].end < day)) continue;
      const len = t.days + (conflictIds.has(t.id) ? 1 : 0);
      const u = use[taskSkill(t)] || (use[taskSkill(t)] = []);
      const cap = Math.max(crew[taskSkill(t)] ?? 0, t.people);
      if (Array.from({ length: len }, (_, i) => (u[day + i] || 0) + t.people > cap).some(Boolean)) continue;
      for (let i = 0; i < len; i++) u[day + i] = (u[day + i] || 0) + t.people;
      const ready = Math.max(run.starts[t.id], t.holdDay || 1, ...t.deps.map(d => actual[d].end + 1));
      actual[t.id] = { start: day, end: day + len - 1, rework: len > t.days, waitedForPeople: Math.max(0, day - ready) };
      pending.splice(pending.indexOf(t), 1);
    }
  }
  const workEnd = Math.max(...tasks.map(t => actual[t.id].end));
  return {
    actual, workEnd,
    overDays: run.plan.overDays,
    delay: S.phaseDelay,
    finish: workEnd + S.phaseDelay,
    rework: tasks.filter(t => actual[t.id].rework),
    waited: tasks.filter(t => actual[t.id].waitedForPeople),
  };
}

function finalizePhase() {
  const ph = phase();
  const tasks = S.phaseRun.tasks;
  const sim = simulatePhase();
  // Výluka: co se do okna nevejde, přesune se do další výluky (rezerva projektu se čerpá až v poslední).
  const windowed = ph.window && S.sprint < periods();
  let overrun = Math.max(0, sim.finish - ph.days);
  let carry = [];
  let base;
  const before = S.buffer;
  if (windowed) {
    const limit = ph.days - S.phaseDelay;
    carry = tasks.filter(t => sim.actual[t.id].end > limit).map(t => {
      const a = sim.actual[t.id];
      return {
        id: `${t.id}${S.sprint}`, name: t.carried ? t.name : `${t.name} – dokončení`, days: Math.max(1, a.end - Math.max(limit, a.start - 1)),
        people: t.people, skill: t.skill, deps: [], carried: true, note: 'Nestihlo se v minulé výluce – dokončuje se teď.',
      };
    });
    base = carry.length ? { spokojenost: -4 * carry.length, rozpocet: -3 * carry.length } : { spokojenost: 4, harmonogram: 2 };
  } else {
    S.buffer -= overrun;
    S.overrunTotal += overrun;
    base = overrun ? { spokojenost: -3 * overrun } : { spokojenost: 4, harmonogram: 2 };
  }
  const beyond = Math.max(0, -S.buffer) - Math.max(0, -before);
  const deltas = applyEffects(addEffects(
    base,
    beyond ? { harmonogram: -5 * beyond, rozpocet: -4 * beyond } : {},
    sim.rework.length ? { rozpocet: -sim.rework.length, moralka: -sim.rework.length } : {},
    sim.overDays ? { moralka: -Math.min(8, 2 * sim.overDays) } : {},
  ));
  const late = windowed ? carry.length > 0 : overrun > 0;
  if (windowed && !carry.length) overrun = 0;
  S.carryIn = carry;
  S.overrunTotal += carry.length;
  S.milestones[ph.id] = late ? 'late' : 'ok';
  S.phaseResults[S.sprint - 1] = { finish: sim.finish, overrun, carried: carry.length };
  S.review = {
    phase: ph, tasks, sim, plan: S.phaseRun.plan, starts: S.phaseRun.starts, deps: S.phaseRun.deps,
    overrun, beyond, buffer: S.buffer, deltas, carry, windowed, late,
    plannedMD: sum(tasks, taskMD), actualMD: sum(tasks, taskMD) + sum(sim.rework, t => t.people),
    ongoing: applyOngoing(), reveals: [],
  };
}

// ---------- Úroveň Hard: změna kontextu a opožděné následky ----------

// Změny kontextu: Hard má jednu hned po kontrolním bodu, projekt měnící tvář jich má víc.
const shifts = () => S.sc.shifts || (S.sc.shift ? [{ ...S.sc.shift, after: gateAfter() }] : []);
const curShift = () => shifts()[S.shiftCur];
const pendingShiftIdx = () => shifts().findIndex((sh, i) => sh.after === S.sprint && !S.shiftsDone.includes(i));
const maxShiftAdds = () => curShift().maxAdds ?? MAX_SHIFT_ADDS;

// Změna kontextu: odhalí skrytý faktor, případně změní typ projektu, upraví backlog a tým a otevře přeskládání mixu.
function applyShift() {
  S.shiftCur = pendingShiftIdx();
  const sh = curShift();
  S.hiddenRevealed = true;
  if (sh.context) S.extraContext.push(sh.context);
  const prevApproach = AP();
  if (sh.approach) S.approach = sh.approach;
  const devalued = [];
  if (sh.devalue) {
    for (const b of S.backlog) {
      if (b.done || b.category !== sh.devalue.category) continue;
      b.actual = sh.devalue.actual;
      S.verified = S.verified.filter(id => id !== b.id);
      devalued.push(b);
    }
  }
  const added = addItems(sh.addItems);
  S.shiftCapacity -= sh.capacityLoss || 0;
  for (const id of sh.addStakeholders || []) S.stake[id] = stakeholderById(id).start ?? STAKE_START;
  const teamNotes = applyTeam(sh.team);
  S.reshape = { original: S.mix.slice(), mix: S.mix.slice(), devalued, added, teamNotes, prevApproach };
  S.shiftResult = null;
}

const reshapeAdds = () => S.reshape.mix.filter(id => !S.reshape.original.includes(id));

function confirmReshape() {
  const sh = curShift();
  const adds = reshapeAdds();
  const removed = S.reshape.original.filter(id => !S.reshape.mix.includes(id));
  S.mix = S.reshape.mix.slice();
  S.mixCost = currentMixCost();
  const costDeltas = applyEffects(addEffects(...adds.map(() => SHIFT_ADD_COST)));
  // needs: seznam praktik (stačí jedna), nebo seznam skupin (z každé skupiny aspoň jedna).
  const groups = Array.isArray(sh.needs[0]) ? sh.needs : [sh.needs];
  const adapted = groups.every(g => g.some(has));
  S.shiftAdapted = adapted;
  S.shiftPenalty = adapted ? null : sh.penalty;
  S.shiftDelay = adapted ? 0 : sh.delayIfNot || 0;
  // Praktiky, které sedí na nově odhalený kontext, se teď vyplatí.
  const newCtx = sh.context || S.sc.hiddenContext;
  const hiddenFits = chosenPractices().filter(p => (p.fits || []).includes(newCtx));
  const fitDeltas = applyEffects(addEffects(...hiddenFits.map(() => CONTEXT_FIT_EFFECTS)));
  // Když se změní typ projektu, posuzuje se celý mix – i praktiky, které novému typu škodí.
  const newBad = (sh.approach ? chosenPractices() : adds.map(practiceById)).filter(p => isTrap(p) || isMisfit(p));
  const rating = adapted && !newBad.length && S.mixCost <= budget() + 1 ? 'best' : adapted ? 'ok' : 'bad';
  const icons = ids => ids.map(id => practiceById(id).icon).join(' ') || '–';
  recordDecision(`Změna kontextu: ${sh.title}`,
    { rating, text: adds.length || removed.length ? `přidáno ${icons(adds)}, odebráno ${icons(removed)}` : 'mix beze změny' }, sh.lesson);
  // Reakce na změnu kontextu je klíčová lekce – v úsudku váží dvojnásob.
  S.insight += RATING_POINTS[rating];
  S.insightMax += RATING_POINTS.best;
  S.shiftsDone.push(S.shiftCur);
  S.shiftResult = { adapted, adds, removed, newBad, hiddenFits, deltas: addEffects(costDeltas, fitDeltas), reveals: revealPatterns('shift') };
}

// Opožděný následek: navazující událost se vloží o několik období později.
// Když se do projektu nevejde, dopadne na projekt až po jeho konci.
function scheduleFollowup(choice, ev) {
  const fu = (S.sc.followups || {})[choice.later.event];
  if (!fu) return null;
  const meta = { echo: true, good: choice.rating === 'best', fromTitle: ev.title, fromChoice: choice.text, fromSprint: S.sprint };
  let idx = S.sprint - 1 + choice.later.after;
  while (idx < periods() && S.events[idx] && S.events[idx].echo) idx++;
  if (idx < periods()) {
    S.events[idx] = { ...prepDecision(fu, S.sc.terms), ...meta };
    return idx + 1;
  }
  S.aftermath.push({ ...meta, title: fu.title, text: fu.unresolvedText || fu.text, effects: fu.unresolved || {} });
  return null;
}

function applyAftermath() {
  if (S.aftermathApplied) return;
  S.aftermathApplied = true;
  for (const a of S.aftermath) a.deltas = applyEffects(a.effects);
}

// ---------- Nemožná úroveň: diagnóza, provoz a rok poté ----------

// Antivzorce, které v převzatém projektu skutečně působí (podle mixu předchozího vedení).
function takeoverTruth() {
  const saved = S.mix;
  S.mix = S.sc.takeover.mix;
  const ids = activePatterns().filter(p => p.type === 'anti').map(p => p.id);
  S.mix = saved;
  return ids;
}

function evaluateDiagnosis() {
  const truth = takeoverTruth();
  const picks = S.diag.picks;
  const hits = picks.filter(id => truth.includes(id));
  const wrong = picks.filter(id => !truth.includes(id));
  const missed = truth.filter(id => !picks.includes(id));
  const points = Math.max(0, DIAG_POINTS * (hits.length - wrong.length));
  S.insight += points;
  S.insightMax += DIAG_POINTS * truth.length;
  const names = ids => ids.map(id => PATTERNS.find(p => p.id === id).name).join(', ') || 'žádné';
  S.lessons.push({
    title: 'Diagnóza převzatého projektu',
    rating: !wrong.length && !missed.length ? 'best' : hits.length > wrong.length ? 'ok' : 'bad',
    choice: `správně ${hits.length} z ${truth.length} · navíc: ${names(wrong)} · přehlédnuto: ${names(missed)}`,
    lesson: S.sc.takeover.diagLesson,
  });
  S.diag.result = { hits, wrong, missed, truth };
}

// Projekt, nebo provoz (4): rutinu je lepší předat liniové organizaci, než ji řídit jako projekt.
function evaluateOps() {
  const all = [...S.backlog, ...S.handedOver];
  const ops = all.filter(b => b.ops);
  if (!ops.length && !S.sc.workstreams?.some(w => w.answer === 'ops')) return;
  const handedOps = S.handedOver.filter(b => b.ops);
  const handedReal = S.handedOver.filter(b => !b.ops);
  const doneOps = ops.filter(b => b.done);
  S.insightMax += OPS_POINTS * ops.length;
  S.insight += Math.max(0, OPS_POINTS * (handedOps.length - handedReal.length));
  S.lessons.push({
    title: 'Projekt, nebo provoz?',
    rating: handedOps.length === ops.length && !handedReal.length ? 'best' : handedOps.length && handedOps.length >= handedReal.length ? 'ok' : 'bad',
    choice: `provozu předáno ${handedOps.length} z ${ops.length} rutinních úkolů${doneOps.length ? ` · v projektu se dělalo: ${doneOps.map(b => b.name).join(', ')}` : ''}${handedReal.length ? ` · omylem předáno: ${handedReal.map(b => b.name).join(', ')}` : ''}`,
    lesson: 'Projekt je dočasné úsilí s jedinečným výsledkem. Opakovanou rutinu (reporty, podpora, údržba) má dělat linie – když se řídí jako projekt, jen spotřebovává kapacitu a nic nového nevznikne.',
  });
}

// Rok poté (6): co z projektu po roce zbylo – kvalita, předání, znalosti, lidé a podpora stakeholderů.
function computeEpilog() {
  const t = S.sc.terms;
  const cards = [];
  const add = (icon, title, text, pts) => cards.push({ icon, title, text, pts });
  const q = S.metrics.kvalita;
  if (q >= 60) add('📈', 'Stabilní provoz', `${t.product} běží spolehlivě a provoz hlásí jen drobnosti.`, 15);
  else if (q >= 40) add('🩹', 'Občasné výpadky', `${t.product} funguje, ale každý měsíc se něco opravuje.`, 0);
  else add('🚨', 'Série incidentů', `${t.product} padá a opravy stojí víc, než projekt ušetřil.`, -20);

  const ho = S.backlog.find(b => b.handover);
  if (ho) {
    if (ho.done) add('📦', 'Předáno do provozu', 'Provoz převzal dokumentaci a proškolené lidi. Projektový tým se může věnovat dalšímu projektu.', 15);
    else add('📭', 'Předání bez předání', 'Projekt skončil, ale provoz nedostal dokumentaci ani školení. Projektový tým je další rok „na telefonu“.', -15);
  }

  const areas = Object.keys(S.sc.areas || {});
  const none = areas.filter(a => !knowers(a).length);
  const single = areas.filter(a => knowers(a).length === 1);
  if (none.length) add('🕳️', 'Nikdo tomu nerozumí', `Po roce už nikdo nerozumí: ${none.map(areaLabel).join(', ')}. Každá změna je dobrodružství.`, -15);
  else if (single.length) add('🏝️', 'Úzká hrdla', single.map(a => `${areaLabel(a)} umí jen ${knowers(a)[0].name}`).join(', ') + '. Když odejdou, je problém.', -5 * Math.min(3, single.length));
  else if (areas.length) add('🧠', 'Znalosti zůstaly v týmu', 'Každou část řešení umí aspoň dva lidé.', 15);

  const team = present();
  const avgFatigue = team.length ? sum(team, p => p.fatigue) / team.length : 100;
  if (S.metrics.moralka < 35 || avgFatigue >= FATIGUE.warn) add('🚪', 'Tým se rozešel', 'Unavení lidé po projektu odešli – i s tím, co věděli.', -15);
  else if (S.metrics.moralka >= 60) add('🤝', 'Tým zůstal', 'Lidé chtějí na řešení dál pracovat a rozvíjet ho.', 10);

  const opsInProject = S.opsOverhead + S.backlog.filter(b => b.ops && b.done).length;
  if (opsInProject) add('⚙️', 'Provoz v převleku za projekt', 'Rutina, která se řídila jako projekt, zůstala bez vlastníka v linii. Po skončení projektu ji nikdo nedělá.', -10);
  else add('⚙️', 'Jasná hranice projektu', 'Rutinu od začátku dělala linie – po projektu se nic nerozpadlo.', 5);

  const min = stakeMin();
  if (min !== null) {
    const [id] = Object.entries(S.stake).sort((a, b) => a[1] - b[1])[0];
    const s = stakeholderById(id);
    if (min < 30) add('😠', 'Ztracená podpora', `${s.icon} ${s.name} ${s.epilogBad}`, -15);
    else if (min >= 55) add('🌟', 'Podpora všech stran', 'Všichni stakeholdeři řešení po roce aktivně používají a podporují.', 10);
  }

  if (S.aftermath.length) add('⏳', 'Odložené problémy', `Vrátilo se ${S.aftermath.length} dříve odložených problémů.`, -5 * S.aftermath.length);

  const months = ['Za měsíc', 'Za 2 měsíce', 'Za 3 měsíce', 'Za 5 měsíců', 'Za 7 měsíců', 'Za 9 měsíců', 'Za rok'];
  cards.forEach((c, i) => { c.when = months[Math.round(i * (months.length - 1) / Math.max(1, cards.length - 1))]; });
  S.epilog = { cards, sustain: clamp(50 + sum(cards, c => c.pts)) };
}

// Uzavře projekt jednou: dozvuky, vyhodnocení provozu a rok poté.
function closeProject() {
  if (S.closed) return;
  S.closed = true;
  if (!S.failed) applyAftermath();
  if (!isInsane()) return;
  evaluateOps();
  if (!S.failed) computeEpilog();
}

// ---------- Akce ----------

const ACTIONS = {
  pickScenario({ id }) {
    const sc = SCENARIOS.find(x => x.id === id);
    if (!levelUnlocked(sc.level)) return;
    startScenario(id);
  },

  start() { S.screen = S.sc.takeover ? 'diagnose' : 'sort'; },

  diagPick({ id }) {
    if (S.diag.result) return;
    const p = S.diag.picks;
    S.diag.picks = p.includes(id) ? p.filter(x => x !== id) : [...p, id];
  },

  diagEval() {
    if (!S.diag.result && S.diag.picks.length) evaluateDiagnosis();
  },

  sortPick({ id, val }) { if (!S.sortResult) S.sortAnswers[id] = val; },

  sortEval() {
    let correct = 0;
    for (const w of S.sc.workstreams) {
      S.insightMax += 5;
      if (S.sortAnswers[w.id] === w.answer) { correct++; S.insight += 5; }
    }
    const total = S.sc.workstreams.length;
    const wrong = total - correct;
    // Rutina řízená jako projekt ukrajuje kapacitu po celý projekt; projektová práce odložená do provozu propadne.
    const wrongWs = S.sc.workstreams.filter(w => S.sortAnswers[w.id] !== w.answer);
    S.opsOverhead = wrongWs.filter(w => w.answer === 'ops').length;
    const toOps = wrongWs.filter(w => S.sortAnswers[w.id] === 'ops').length;
    const deltas = applyEffects(addEffects(
      { kvalita: -3 * (wrong - S.opsOverhead - toOps), harmonogram: -2 * (wrong - S.opsOverhead - toOps) },
      { kvalita: -4 * toOps, harmonogram: -3 * toOps },
    ));
    S.sortResult = { correct, wrong, deltas, opsOverhead: S.opsOverhead };
    const hasOps = S.sc.workstreams.some(w => w.answer === 'ops');
    S.lessons.push({
      title: 'Rozdělení práce',
      rating: wrong === 0 ? 'best' : wrong <= 2 ? 'ok' : 'bad',
      choice: `${correct} z ${total} oblastí správně · ${APPROACHES[AP()].label}${hints() || !wrong ? '' : ` · chybně: ${wrongWs.map(w => w.name).join(', ')}`}`,
      lesson: 'Jasné a stabilní požadavky → prediktivně. Nejistota a potřeba zpětné vazby → agilně. Hybrid jen tam, kde projekt obsahuje obojí.'
        + (hasOps ? ' A opakovaná rutina není projekt vůbec – patří do provozu.' : ''),
    });
  },

  toToolbox() { S.screen = 'toolbox'; },

  togglePractice({ id }) {
    if (S.mixResult) return;
    S.mix = has(id) ? S.mix.filter(x => x !== id) : [...S.mix, id];
  },

  confirmMix() {
    if (S.mixResult) return;
    evaluateMix();
  },

  toKickoff() {
    if (checkFail()) return;
    S.screen = 'kickoff';
  },

  toPlan() {
    if (isPhased()) initGantt();
    S.screen = 'plan';
  },

  toggle({ id }) {
    const idx = S.selected.indexOf(id);
    if (idx >= 0) S.selected.splice(idx, 1);
    else if (!itemLock(S.backlog.find(b => b.id === id))) S.selected.push(id);
  },

  handover({ id }) {
    const it = S.backlog.find(b => b.id === id);
    if (!isInsane() || !it || it.done) return;
    S.backlog = S.backlog.filter(b => b !== it);
    S.selected = S.selected.filter(x => x !== id);
    S.handedOver.push(it);
    // Skutečnou projektovou práci provoz neudělá – její vlastník to nese těžce.
    if (!it.ops && it.owner) applyStake({ [it.owner]: -6 });
  },

  experiment({ id }) {
    const it = S.backlog.find(b => b.id === id);
    if (!has('lean') || !it || valueKnown(it) || S.experiments >= expPerSprint()) return;
    S.experiments++;
    S.verified.push(id);
  },

  ganttStart({ task, day }) { S.gantt.starts[task] = +day; },

  ganttDep({ task, dep }) {
    const list = S.gantt.deps[task];
    S.gantt.deps[task] = list.includes(dep) ? list.filter(d => d !== dep) : [...list, dep];
  },

  ganttAuto() {
    if (!hasPlanning()) return;
    const ph = phase();
    const tasks = phaseTasks();
    const es = earliestStarts(tasks, S.gantt.deps);
    for (const t of tasks) S.gantt.starts[t.id] = Math.min(es[t.id], ph.days + GANTT_EXTRA_DAYS - t.days + 1);
  },

  startPhase() {
    const ev = evaluateGantt();
    const ph = phase();
    const conflicts = ev.trueConflicts.length + ev.holdConflicts.length;
    const rating = !conflicts && !ev.overDays && !ev.missed.length && ev.finish <= ph.days ? 'best'
      : conflicts <= 1 && ev.overDays <= 1 && ev.finish <= ph.days + 1 ? 'ok' : 'bad';
    recordDecision(`Gantt etapy ${S.sprint}: ${ph.name}`,
      { rating, text: `plán do dne ${ev.finish} z ${ph.days}, konflikty ${conflicts}, přetížení ${days(ev.overDays)}` }, GANTT_LESSON);
    S.phaseRun = { plan: ev, tasks: phaseTasks(), starts: { ...S.gantt.starts }, deps: JSON.parse(JSON.stringify(S.gantt.deps)) };
    S.current = { event: S.events[S.sprint - 1], result: null, isGate: false };
    S.screen = 'event';
  },

  startSprint() {
    runSprint();
    S.current = { event: S.events[S.sprint - 1], result: null, isGate: false };
    S.screen = 'event';
  },

  eventPick({ i }) {
    if (S.current.result) return;
    const ev = S.current.event;
    const choice = ev.choices[+i];
    if (choice.needs && !has(choice.needs)) return;
    const soft = softenEffects(choice.effects, ev.track);
    let effects = soft.effects;
    if (S.current.isGate) effects = addEffects(effects, ...chosenPractices().map(p => p.gateBonus));
    const deltas = applyEffects(effects);
    const stakeDeltas = applyStake(choice.stake);
    const teamNotes = applyTeam(choice.team);
    if (choice.capacityMod) S.capacityMod += choice.capacityMod;
    if (choice.dropScope) S.backlog = S.backlog.filter(b => b.done || b.moscow !== choice.dropScope);
    const added = addItems(choice.addItems);
    let delay = 0;
    if (choice.delay) {
      // Riziková rezerva zmírní i zpoždění etapy.
      delay = has('risk') ? Math.round(choice.delay * 0.6) : choice.delay;
      if (delay < choice.delay && !soft.by.some(p => p.id === 'risk')) soft.by.push(practiceById('risk'));
      S.phaseDelay += delay;
    }
    for (const id of choice.verify || []) if (!S.verified.includes(id)) S.verified.push(id);
    recordDecision(ev.title, choice, ev.lesson);
    if (choice.later) scheduleFollowup(choice, ev);
    if (ev.echo) S.echoes[ev.good ? 'good' : 'bad']++;
    const reveals = [
      ...(ev.echo ? revealPatterns(ev.good ? 'echo-good' : 'echo-bad') : []),
      ...(soft.by.some(p => p.id === 'risk') ? revealPatterns('soften') : []),
      ...(S.current.isGate ? revealPatterns('gate') : []),
    ];
    S.current.result = { i: +i, deltas, stakeDeltas, teamNotes, softenedBy: soft.by, added, delay, later: !!choice.later, reveals };
  },

  eventNext() {
    if (checkFail()) return;
    if (S.current.isGate) {
      S.gateDone = true;
      if (pendingShiftIdx() >= 0) {
        applyShift();
        S.screen = 'shift';
        return;
      }
      nextSprint();
      return;
    }
    if (isPhased()) {
      finalizePhase();
      S.review.reveals = [...(S.sprint === 1 ? revealPatterns('m1') : []), ...revealPatterns('sprint')];
      S.screen = 'review';
      return;
    }
    const milestone = checkMilestone();
    S.review.milestone = milestone;
    S.review.reveals = [
      ...(milestone && milestone.kind === 'dependency' ? revealPatterns('m1') : []),
      ...revealPatterns('sprint'),
    ];
    S.screen = 'review';
  },

  reviewNext() {
    if (checkFail()) return;
    if (S.sprint >= periods()) {
      closeProject();
      S.screen = S.epilog ? 'epilog' : 'end';
      return;
    }
    if (S.sprint === gateAfter() && !S.gateDone) {
      S.current = { event: S.gate, result: null, isGate: true };
      S.screen = 'event';
      return;
    }
    if (pendingShiftIdx() >= 0) {
      applyShift();
      S.screen = 'shift';
      return;
    }
    nextSprint();
  },

  epilogNext() { S.screen = 'end'; },

  reshapeToggle({ id }) {
    if (S.shiftResult) return;
    const r = S.reshape;
    if (r.mix.includes(id)) r.mix = r.mix.filter(x => x !== id);
    else if (r.original.includes(id) || reshapeAdds().length < maxShiftAdds()) r.mix = [...r.mix, id];
  },

  confirmShift() {
    if (S.shiftResult) return;
    confirmReshape();
  },

  shiftNext() {
    if (checkFail()) return;
    nextSprint();
  },

  glossary() { S.modal = S.modal === 'glossary' ? null : 'glossary'; },
  atlas() { S.modal = S.modal === 'atlas' ? null : 'atlas'; },
  closeModal() { S.modal = null; },
  replay() { startScenario(S.sc.id); },
  restart() { newGame(); },
};

function nextSprint() {
  S.sprint++;
  S.reportHistory.push({ ...S.metrics });
  S.selected = [];
  S.experiments = 0;
  if (isPhased()) initGantt();
  S.screen = 'plan';
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  // Klik dovnitř okna ho nemá zavřít, jen klik na pozadí.
  if (el.classList.contains('modal-back') && e.target !== el) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  const prevScreen = S.screen;
  fn(el.dataset);
  render();
  if (S.screen !== prevScreen) window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.modal) { S.modal = null; render(); }
});

// ---------- Vykreslování ----------

function render() {
  const screens = { intro, brief, sort, toolbox, kickoff, end, event, shift, diagnose, epilog,
    plan: () => (isPhased() ? ganttPlan() : plan()),
    review: () => (isPhased() ? phaseReview() : review()) };
  const showHud = !['intro', 'brief', 'end', 'epilog'].includes(S.screen);
  app.innerHTML = `
    ${header()}
    ${showHud ? hud() : ''}
    <main class="screen screen-${S.screen}">${screens[S.screen]()}</main>
    ${S.modal === 'glossary' ? glossaryModal() : ''}
    ${S.modal === 'atlas' ? atlasModal() : ''}
  `;
}

function header() {
  return `
    <header class="topbar">
      <div class="brand"><span class="logo">${S.sc ? S.sc.icon : '⚗️'}</span> Projektová alchymie
        <small>${S.sc ? S.sc.name : 'namíchej správné řízení pro každý projekt'}</small></div>
      <div class="top-btns">
        <button class="btn ghost" data-action="atlas">🗺️ Atlas</button>
        <button class="btn ghost" data-action="glossary">📖 Slovníček</button>
      </div>
    </header>`;
}

function meterClass(v) { return v < 35 ? 'low' : v < 60 ? 'mid' : 'high'; }

// Mlha reportingu: bez dashboardu nebo EVM vidíš stav o období zpožděný a jen v rozmezí.
const round5 = v => Math.round(v / 5) * 5;
const fogRange = v => [Math.max(0, round5(v) - 5), Math.min(100, round5(v) + 5)];

function hud() {
  const fog = fogged();
  const h = S.reportHistory;
  const shown = fog ? h[Math.max(0, h.length - 2)] : S.metrics;
  const meters = METRICS.map(m => {
    const v = shown[m.id];
    const [lo, hi] = fogRange(v);
    return `
      <div class="meter ${meterClass(v)} ${fog ? 'fog' : ''}" title="${fog ? `${m.label}: odhad ${lo}–${hi}, stav k minulému období` : `${m.label}: ${v} / 100`}">
        <div class="meter-head"><span>${m.icon} ${m.label}</span><b>${fog ? `${lo}–${hi}` : v}</b></div>
        <div class="bar">${fog ? `<i style="width:${hi}%"></i>` : `<i style="width:${v}%"></i>`}</div>
      </div>`;
  }).join('');
  const stakes = Object.keys(S.stake).length ? `
    <div class="stake-row" aria-label="Stakeholdeři">
      ${Object.entries(S.stake).map(([id, v]) => {
        const s = stakeholderById(id);
        return `<div class="stake ${meterClass(v)}" title="${s.name}: ${s.wants}"><span class="stake-icon">${s.icon}</span><span><b>${s.name}</b><small>${s.wants}</small></span><span class="mood">${fog ? moodIcon(v) : `${moodIcon(v)} ${v}`}</span></div>`;
      }).join('')}
    </div>` : '';
  return `
    <section class="hud ${fog ? 'fogged' : ''}" aria-label="Stav projektu">${meters}</section>
    ${fog ? '<p class="fog-note">🌫️ Bez dashboardu nebo EVM vidíš stav jen nahrubo a s jednoperiodovým zpožděním.</p>' : ''}
    ${stakes}`;
}

const moodIcon = v => (v < 25 ? '😠' : v < 45 ? '😟' : v < 65 ? '😐' : '🙂');

function stakeChips(deltas) {
  return Object.entries(deltas || {}).filter(([, v]) => v !== 0).map(([id, v]) => {
    const s = stakeholderById(id);
    return `<span class="chip ${v > 0 ? 'up' : 'down'}">${fogged() ? (v > 0 ? '▲' : '▼') : signed(v)} ${s.icon} ${s.name}</span>`;
  }).join('');
}

function deltaChips(deltas) {
  const entries = Object.entries(deltas || {}).filter(([, v]) => v !== 0);
  if (!entries.length) return '<span class="chip neutral">beze změny metrik</span>';
  // V mlze reportingu je vidět jen směr změny, ne její velikost.
  const fog = S.sc && S.screen !== 'end' && fogged();
  return entries.map(([k, v]) => {
    const m = metricById(k);
    return `<span class="chip ${v > 0 ? 'up' : 'down'}">${fog ? (v > 0 ? '▲' : '▼') : `${v > 0 ? '+' : ''}${v}`} ${m.icon} ${m.label}</span>`;
  }).join('');
}

function contextChips() {
  const chips = visibleContext().map(t => `<span class="ctx ${t === S.sc.hiddenContext ? 'revealed' : ''}">${CONTEXT_TAGS[t].icon} ${CONTEXT_TAGS[t].label}</span>`);
  if (S.sc.hiddenContext && !S.hiddenRevealed) chips.push('<span class="ctx hidden-ctx" title="Odhalí se během projektu">❓ Skrytý faktor</span>');
  return chips.join('');
}

const approachChip = () => `<span class="ctx approach ${AP()}">${APPROACHES[AP()].icon} ${APPROACHES[AP()].label}</span>`;

// Karta vzorce v řetězci kontext → forma → mechanismus → důsledek.
function patternCard(p, { deltas, story } = {}) {
  return `
    <div class="pattern ${p.type}">
      <div class="pattern-head"><span class="pattern-icon">${p.icon}</span><b>${p.name}</b><span class="ptype">${PATTERN_TYPE[p.type]}</span></div>
      ${story ? `<p class="story">${p.story}</p>` : ''}
      <ol class="kfmd">
        <li><span>Kontext</span>${p.k}</li>
        <li><span>Forma</span>${p.f}</li>
        <li><span>Mechanismus</span>${p.m}</li>
        <li><span>Důsledek</span>${p.d}</li>
      </ol>
      ${deltas && Object.keys(deltas).length ? `<div class="chips">${deltaChips(deltas)}</div>` : ''}
    </div>`;
}

function revealBlock(reveals) {
  // Bez nápověd (nemožná úroveň): vzorce se ukážou až na konci projektu.
  if (!reveals || !reveals.length || !hints()) return '';
  return `
    <div class="reveal">
      <h3>🔓 ${reveals.length > 1 ? 'Odhaleny vzorce' : 'Odhalen vzorec'}</h3>
      <p class="hint">Mechanismus působil od chvíle, kdy jsi zvolil(a) svůj mix praktik. Teď se ukázal jeho důsledek.</p>
      ${reveals.map(r => patternCard(r.p, { deltas: r.deltas, story: true })).join('')}
    </div>`;
}

function timeline() {
  if (isPhased()) return phaseTimeline();
  const [top, bottom] = TIMELINE_LABELS[AP()];
  const cells = [];
  for (let s = 1; s <= periods(); s++) {
    const cls = s < S.sprint ? 'past' : s === S.sprint ? 'now' : '';
    cells.push(`<div class="sprint-cell ${cls}">${per().nom} ${s}<small>týden ${s * 2 - 1}–${s * 2}</small></div>`);
  }
  const lateLabel = AP() === 'agile' ? ' (nesplněno)' : ' (zpoždění)';
  const ms = S.sc.milestones.map(m => {
    const st = S.milestones[m.id] || 'pending';
    return `<div class="ms ${st}" style="grid-column:${m.afterSprint}">
      <span class="diamond">◆</span>${m.icon} ${m.name}${st === 'late' ? lateLabel : st === 'ok' ? ' ✓' : ''}</div>`;
  }).join('');
  return `
    <section class="timeline" aria-label="Časová osa projektu">
      <div class="track-label">${top[0]} <small>${top[1]}</small></div>
      <div class="track pred">${ms}</div>
      <div class="track-label">${bottom[0]} <small>${bottom[1]}</small></div>
      <div class="track agile">${cells.join('')}</div>
    </section>`;
}

function intro() {
  const atlas = getAtlas();
  const unlocked = hardUnlocked();
  const insaneOpen = insaneUnlocked();
  const row = sc => {
    const rec = getRecord(sc.id);
    const locked = !levelUnlocked(sc.level);
    return `
      <button class="project-row ${sc.level || ''} ${locked ? 'locked' : ''}" data-action="pickScenario" data-id="${sc.id}" ${locked ? 'disabled' : ''}>
        <span class="pr-icon">${locked ? '🔒' : sc.icon}</span>
        <span class="pr-main"><b>${sc.name}</b><small>${sc.tagline}</small></span>
        <span class="pr-meta">${locked ? 'Zamčeno' : rec ? `🏅 ${rec} bodů` : 'Zatím nehráno'}</span>
        <span class="pr-go" aria-hidden="true">${locked ? '' : '▶'}</span>
      </button>`;
  };
  const steps = [
    ['Rozděl práci', 'Co řídit prediktivně a co agilně? A je to vůbec hybrid?'],
    ['Slož mix praktik', 'Karty se synergiemi, konflikty a omezenou režií.'],
    ['Řiď projekt', 'Sprint po sprintu, nebo etapu po etapě. Plánuj, řeš krize, hlídej milníky.'],
    ['Odhal vzorce', 'Co tvůj mix v projektu doopravdy způsobil – dobré i špatné.'],
  ];
  return `
    <div class="hero card intro-hero">
      <img class="hero-art" src="img/alchymie.webp" alt="Postava v zástěře míchá v kotli projektovou metodiku, z páry stoupají Ganttův diagram, zelená fajfka a šipky iterace" width="1536" height="1024">
      <h1>Projektová alchymie</h1>
      <p class="tagline">Namíchej správné řízení pro každý projekt</p>
      <p class="lead">Některé projekty se dají naplánovat dopředu, jiné se musí objevovat za pochodu a některé kombinují obojí. Univerzální recept neexistuje.</p>
    </div>
    <h2 class="section-title">Co tě čeká</h2>
    <div class="tile-grid">
      ${steps.map(([t, d], i) => `<div class="tile"><span class="tile-num">${i + 1}</span><b>${t}</b><p>${d}</p></div>`).join('')}
    </div>
    <div class="tile-grid two">
      <div class="tile soft"><b>🎲 Pokaždé jinak</b><p>Každá hra vylosuje jiné události a odpovědi jsou pokaždé v jiném pořadí.</p></div>
      <button class="tile soft tile-btn" data-action="atlas"><b>🗺️ Atlas vzorců</b><p>Objeveno ${atlas.length} z ${PATTERNS.length} vzorců a antivzorců.</p></button>
    </div>
    <h2 class="section-title">Vyber si projekt</h2>
    ${levelHead('', '🌱', 'Základní úroveň',
      `Pět projektů na seznámení se hrou: tři hybridní, jeden prediktivní a jeden agilní. Ukazatele startují na ${START_METRIC}, na mix praktik máš ${OVERHEAD_BUDGET} bodů režie a projekt končí, až když některý ukazatel klesne na nulu.`)}
    <div class="project-list">${SCENARIOS.filter(sc => !sc.level).map(row).join('')}</div>
    ${levelHead('hard', '🔥', 'Náročná úroveň', unlocked
      ? `Méně zdrojů, skrytý faktor, změna kontextu uprostřed projektu a rozhodnutí, která se vrací. Ukazatele startují na ${HARD.startMetric}, na mix praktik máš ${HARD.budget} bodů režie a projekt končí už při poklesu ukazatele na ${HARD.failAt}.`
      : `Odemkne se, až v kterémkoli projektu základní úrovně dosáhneš alespoň ${HARD_UNLOCK_SCORE} bodů. Čeká tě méně zdrojů, skrytý faktor, změna kontextu a rozhodnutí, která se vrací.`)}
    <div class="project-list">${SCENARIOS.filter(sc => sc.level === 'hard').map(row).join('')}</div>
    ${levelHead('insane', '🤯', 'Nemožná úroveň', insaneOpen
      ? 'Žádné nápovědy, mlha v reportech, stakeholdeři, kteří chtějí každý něco jiného, konkrétní lidé, kteří se unaví nebo odejdou, rutina převlečená za projekt – a na konci se ukáže, co z projektu zbylo po roce.'
      : `Odemkne se, až v kterémkoli projektu náročné úrovně dosáhneš alespoň ${INSANE_UNLOCK_SCORE} bodů. Bez nápověd, s mlhou v reportech, se stakeholdery, lidmi a tím, co z projektu zbude po roce.`)}
    <div class="project-list">${SCENARIOS.filter(sc => sc.level === 'insane').map(row).join('')}</div>`;
}

function levelHead(cls, icon, title, text) {
  return `<div class="level-head ${cls}"><h3>${icon} ${title}</h3><p>${text}</p></div>`;
}

function brief() {
  const sc = S.sc;
  return `
    <div class="hero card">
      <div class="hero-emoji">${sc.icon}</div>
      <h1>${sc.name}</h1>
      ${sc.level === 'hard' ? '<p class="hard-badge">🔥 Náročná úroveň</p>' : ''}
      ${sc.level === 'insane' ? '<p class="hard-badge insane">🤯 Nemožná úroveň</p>' : ''}
      <p class="lead">${sc.intro}</p>
      <p><b>Co projekt zahrnuje:</b> ${sc.scope}</p>
      <p><b>Kontext projektu:</b></p>
      <div class="ctx-row">${sc.takeover ? approachChip() : ''}${contextChips()}</div>
      ${sc.stakeholders ? `<p><b>Stakeholdeři:</b></p><ul class="people-list">${sc.stakeholders.filter(x => !x.joins).map(x => `<li>${x.icon} <b>${x.name}</b> – ${x.wants}</li>`).join('')}</ul>` : ''}
      ${S.team.length ? `<p><b>Tým:</b></p><ul class="people-list">${S.team.map(p => `<li>${p.icon} <b>${p.name}</b> – ${p.role} <span class="knows">${p.knows.map(areaLabel).join(' · ')}</span></li>`).join('')}</ul>` : ''}
      <p class="hint">${sc.takeover ? 'Projekt přebíráš rozjetý. Nejdřív zjisti, co se v něm děje, pak zasáhni.' : 'Jak projekt řídit, je na tobě – přijdeš na to v první fázi.'} Sleduj pět ukazatelů projektu; když některý spadne ${failAt() ? `na ${failAt()}` : 'na nulu'}, projekt končí.</p>
      <div class="actions">
        <button class="btn primary big" data-action="start">${sc.takeover ? 'Začít diagnózou ▶' : 'Převzít projekt ▶'}</button>
        <button class="btn ghost" data-action="restart">← Jiný projekt</button>
      </div>
    </div>`;
}

function approachReveal() {
  const sc = S.sc;
  const a = APPROACHES[AP()];
  const body = AP() === 'hybrid' ? `
      <p>V jednom projektu se potkávají prvky, které sedí tradičnímu, i prvky, které sedí agilnímu přístupu. Proto potřebuje <b>hybridní řízení</b>: nejde o dva samostatné projekty s různými metodikami (to by byl program), ale o kombinaci prvků obou přístupů v jednom projektu.</p>
      <div class="two-col">
        <div class="mini pred"><h3>📐 Prvky řízené prediktivně</h3><p>${sc.predWorld}</p></div>
        <div class="mini agile"><h3>🔄 Prvky řízené agilně</h3><p>${sc.agileWorld}</p></div>
      </div>` : `<p>${sc.approachText}</p>`;
  return `<div class="approach-reveal ${AP()}"><h3>${a.icon} Tohle je ${a.label.toLowerCase()}</h3>${body}</div>`;
}

function sort() {
  const r = S.sortResult;
  const ws = S.sc.workstreams;
  const allDone = ws.every(w => S.sortAnswers[w.id]);
  // Nemožná úroveň: třetí možnost – tohle vůbec není projekt, ale provoz.
  const withOps = isInsane();
  const ANSWER = { pred: 'prediktivně', agile: 'agilně', ops: 'provoz – není to projekt' };
  const cards = S.sortOrder.map(w => {
    const a = S.sortAnswers[w.id];
    const verdict = r && hints() ? (a === w.answer ? 'correct' : 'wrong') : '';
    return `
      <div class="ws card ${verdict}">
        <div class="ws-head"><span class="ws-icon">${w.icon}</span><b>${w.name}</b></div>
        <div class="ws-btns">
          <button class="btn toggle ${a === 'pred' ? 'on pred' : ''}" data-action="sortPick" data-id="${w.id}" data-val="pred" ${r ? 'disabled' : ''}>📐 Prediktivně</button>
          <button class="btn toggle ${a === 'agile' ? 'on agile' : ''}" data-action="sortPick" data-id="${w.id}" data-val="agile" ${r ? 'disabled' : ''}>🔄 Agilně</button>
          ${withOps ? `<button class="btn toggle ${a === 'ops' ? 'on ops' : ''}" data-action="sortPick" data-id="${w.id}" data-val="ops" ${r ? 'disabled' : ''}>⚙️ Provoz</button>` : ''}
        </div>
        ${verdict ? `<p class="why">${verdict === 'correct' ? '✅' : `❌ Správně: ${ANSWER[w.answer]}.`} ${w.why}</p>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="phase-title"><span class="phase">Fáze 1 / 3</span><h2>Rozděl práci</h2>
      <p>U každé oblasti projektu rozhodni, zda ji řídit <b>prediktivně</b> (plán předem, vodopád) nebo <b>agilně</b> (iterace, zpětná vazba)${withOps ? ' – nebo jestli to vůbec není projekt, ale běžný <b>provoz</b>, který patří linii' : ''}.</p>
      ${hints() ? '<p class="hint">Tip: Jak jasné jsou požadavky? Jak drahá je změna v průběhu? Dá se výsledek dodávat po kouscích? Projekt nemusí být hybridní.</p>' : ''}
    </div>
    <div class="ws-grid">${cards}</div>
    ${r && !hints() ? `
      <div class="card result">
        <h3>Rozdělení je zapsané</h3>
        <p>Jak dobře jsi práci rozdělil(a), se ukáže během projektu a v závěrečném hodnocení.</p>
        <div class="chips">${deltaChips(r.deltas)}</div>
        ${approachReveal()}
        <button class="btn primary" data-action="toToolbox">Pokračovat: mix praktik ▶</button>
      </div>` : r ? `
      <div class="card result">
        <h3>Výsledek: ${r.correct} z ${ws.length} správně</h3>
        <p>${r.wrong ? 'Špatně zvolený přístup se v projektu projeví:' : 'Skvělé – každá část má přístup, který jí sedí.'}</p>
        <div class="chips">${deltaChips(r.deltas)}</div>
        ${approachReveal()}
        <div class="lesson">💡 <b>Pravidlo palce:</b> Jasné a stabilní požadavky + drahá změna → prediktivně. Nejistota, potřeba zpětné vazby, možnost dodávat po částech → agilně. <b>Hybridní</b> řízení potřebuje jen projekt, který obsahuje obojí.</div>
        <button class="btn primary" data-action="toToolbox">Pokračovat: mix praktik ▶</button>
      </div>` : `
      <div class="actions"><button class="btn primary" data-action="sortEval" ${allDone ? '' : 'disabled'}>Vyhodnotit (${Object.keys(S.sortAnswers).length}/${ws.length})</button></div>`}
  `;
}

function practiceCard(p) {
  const on = has(p.id);
  const fit = (p.fits || []).some(t => visibleContext().includes(t));
  const pairs = PRACTICE_PAIRS.filter(x => on && (x.a === p.id ? has(x.b) : x.b === p.id && has(x.a)));
  const revealed = !!S.mixResult;
  const trap = revealed && on && isTrap(p) && hints();
  const misfit = revealed && on && isMisfit(p) && hints();
  return `
    <button class="practice ${on ? 'on' : ''} ${trap ? 'trap' : ''} ${misfit ? 'misfit' : ''}" data-action="togglePractice" data-id="${p.id}" ${revealed ? 'disabled' : ''}>
      <span class="pp-head"><span class="pp-icon">${p.icon}</span><b>${p.name}</b>
        <span class="cost" title="Režie řízení">${p.cost ? '●'.repeat(p.cost) : 'zdarma'}</span></span>
      <span class="pp-desc">${p.desc}</span>
      ${hints() ? `<span class="pp-mech">⚙️ ${p.mech}</span>` : ''}
      ${fit && hints() ? '<span class="pp-fit">🎯 sedí na kontext projektu</span>' : ''}
      ${S.sc.takeover && S.sc.takeover.mix.includes(p.id) ? '<span class="pp-orig">📎 zavedl předchozí PM</span>' : ''}
      ${(hints() ? pairs : []).map(x => `<span class="pp-pair ${x.type}">${x.type === 'syn' ? '✨' : '⚡'} s ${practiceById(x.a === p.id ? x.b : x.a).icon}</span>`).join('')}
      ${trap ? '<span class="pp-trap">⚠️ Past: lákavá, ale tady škodí</span>' : ''}
      ${misfit ? '<span class="pp-trap">💤 V tomto typu projektu zbytečná režie</span>' : ''}
    </button>`;
}

function pairList(pairs) {
  if (!pairs.length) return '<p class="hint">Zatím žádné synergie ani konflikty.</p>';
  return `<ul class="pairs">${pairs.map(x => `
    <li class="${x.type}">${x.type === 'syn' ? '✨ Synergie' : '⚡ Konflikt'}: ${practiceById(x.a).icon} + ${practiceById(x.b).icon} – ${x.text}</li>`).join('')}</ul>`;
}

function toolbox() {
  const r = S.mixResult;
  const cost = r ? S.mixCost : currentMixCost();
  const over = cost - budget();
  const columns = Object.keys(WORLD_LABEL).map(w => `
    <div class="pcol"><h3>${WORLD_LABEL[w]}</h3>
      ${PRACTICES.filter(p => p.world === w).map(practiceCard).join('')}
    </div>`).join('');
  const to = S.sc.takeover;
  const summary = r && !hints() ? `
    <div class="card mix-result">
      <h3>${to ? 'Zásah je hotový' : 'Tvůj mix je nastavený'}</h3>
      ${to ? `<p>Zavedeno: ${r.fresh.map(p => `${p.icon} ${p.name}`).join(', ') || 'nic'} · zrušeno: ${r.removed.map(id => `${practiceById(id).icon} ${practiceById(id).name}`).join(', ') || 'nic'}</p>` : ''}
      <div class="chips">${deltaChips(r.deltas)}</div>
      <p class="hint">Na nemožné úrovni ti nikdo neřekne, jestli mix sedí. Poznáš to podle toho, jak se bude projekt vyvíjet – a v závěrečném hodnocení.</p>
      <button class="btn primary" data-action="toKickoff">Pokračovat ▶</button>
    </div>` : r ? `
    <div class="card mix-result">
      <h3>Tvůj mix je nastavený</h3>
      <div class="chips">${deltaChips(r.deltas)}</div>
      <div class="two-col">
        <div>
          <h4>Základy pro ${APPROACHES[AP()].label.toLowerCase()}</h4>
          <ul class="checklist">${r.essentials.map(e => `<li class="${e.ok ? 'ok' : 'ko'}">${e.ok ? '✅' : '❌'} ${e.name}</li>`).join('')}</ul>
        </div>
        <div>
          <h4>Soulad s kontextem</h4>
          ${r.fits.length ? `<ul class="checklist">${r.fits.map(f => `<li class="ok">🎯 ${f.p.icon} ${f.p.name} → ${CONTEXT_TAGS[f.t].label}</li>`).join('')}</ul>` : '<p class="hint">Žádná z praktik necílí na kontext projektu.</p>'}
        </div>
      </div>
      <h4>Synergie a konflikty</h4>
      ${pairList(r.pairs)}
      ${r.traps.length ? `<p class="warn">⚠️ Pasti v mixu: ${r.traps.map(p => `${p.icon} ${p.name}`).join(', ')}</p>` : ''}
      ${r.misfits.length ? `<p class="warn">💤 Zbytečná režie pro tento typ projektu: ${r.misfits.map(p => `${p.icon} ${p.name}`).join(', ')}</p>` : ''}
      ${over > 0 ? `<p class="warn">Režie je ${over} bod(y) nad rozpočtem – kapacita týmu klesne o ${over} každé období.</p>` : ''}
      <div class="lesson">🔍 Co tvůj mix v projektu doopravdy způsobí, se ukáže až za pochodu. Vzorce a antivzorce budeš odhalovat během projektu – každý jako řetězec <b>kontext → forma → mechanismus → důsledek</b>.</div>
      <button class="btn primary" data-action="toKickoff">Pokračovat ▶</button>
    </div>` : `
    <div class="mix-bar card">
      <div class="mix-cost">
        <span>Režie řízení</span>
        <b class="${over > 0 ? 'over' : ''}">${cost} / ${budget()}</b>
        <div class="bar cap ${over > 0 ? 'over' : ''}"><i style="width:${Math.min(100, cost / budget() * 100)}%"></i></div>
        ${over > 0 ? `<small class="warn">kapacita týmu −${over} každé období</small>` : '<small>Každý bod nad rozpočet sníží kapacitu týmu.</small>'}
      </div>
      <div class="mix-pairs">${hints() ? pairList(activePairs()) : to ? `<p class="hint">Zrušit praktiku předchozího vedení nic nestojí. Každá nově zavedená praktika stojí −1 💰 a −1 💪 (změna zaběhnutého procesu v krizi). Nově zavedeno: ${S.mix.filter(id => !to.mix.includes(id)).length}.</p>` : '<p class="hint">Synergie a konflikty praktik musíš odhadnout sám/sama.</p>'}</div>
      <button class="btn primary big" data-action="confirmMix" ${S.mix.length ? '' : 'disabled'}>${to ? 'Potvrdit zásah ▶' : 'Potvrdit mix ▶'}</button>
    </div>`;
  return `
    <div class="phase-title"><span class="phase">Fáze 2 / 3</span><h2>${to ? 'Zasáhni do mixu praktik' : 'Slož mix praktik'}</h2>
      ${to ? '<p>Předchozí vedení řídilo projekt praktikami označenými 📎. Ponech, co pomáhá, zruš, co škodí, a zaveď, co chybí.</p>' : ''}
      <p>Vyber praktiky, kterými budeš projekt řídit. Každá stojí <b>režii řízení</b> (porady, reporty, schvalování) – rozpočet je ${budget()} bodů. Hledej kombinace, které se doplňují a sedí na tento typ projektu.</p>
      <div class="ctx-row"><b>Projekt:</b> ${approachChip()} ${contextChips()}</div>
    </div>
    <div class="pgrid">${columns}</div>
    ${summary}
  `;
}

function choiceCard(item, result, pickAction) {
  const choices = item.choices.map((c, i) => {
    const locked = c.needs && !has(c.needs);
    let cls = locked ? 'locked' : '';
    if (result) cls = i === result.i ? `picked ${hints() ? c.rating : 'neutral'}` : 'dim';
    return `<button class="choice ${cls}" data-action="${pickAction}" data-i="${i}" ${result || locked ? 'disabled' : ''}>
      <span class="choice-letter">${'ABCD'[i]}</span><span>${c.text}
      ${locked ? `<small class="lock-note">🔒 Vyžaduje praktiku: ${practiceById(c.needs).icon} ${practiceById(c.needs).name}</small>` : ''}</span></button>`;
  }).join('');
  let fb = '';
  if (result) {
    const c = item.choices[result.i];
    const best = item.choices.find(x => x.rating === 'best');
    fb = `
      <div class="feedback ${hints() ? c.rating : 'neutral'}">
        ${hints() ? `<div class="rating">${RATING_LABEL[c.rating]}</div>` : ''}
        <p>${c.feedback}</p>
        ${(result.teamNotes || []).map(n => `<p class="team-note">${n}</p>`).join('')}
        <div class="chips">${deltaChips(result.deltas)}${stakeChips(result.stakeDeltas)}${c.capacityMod ? `<span class="chip down">${c.capacityMod} SP kapacita ${per().next}</span>` : ''}${c.dropScope ? `<span class="chip down">„${MOSCOW[c.dropScope].label}“ položky odstraněny</span>` : ''}${(result.added || []).map(a => `<span class="chip neutral">🆕 ${a.name}</span>`).join('')}${result.delay ? `<span class="chip down">⏱️ +${days(result.delay)} zpoždění etapy</span>` : ''}</div>
        ${result.softenedBy && result.softenedBy.length ? `<p class="softened">🛡️ Dopad zmírnila praktika: ${result.softenedBy.map(p => `${p.icon} ${p.name}`).join(', ')}</p>` : ''}
        ${c.rating !== 'best' && hints() ? `<p class="best-was">Nejlepší volba: <b>${best.text}</b>${best.needs && !has(best.needs) ? ' – ale tvůj mix praktik ji neumožnil.' : ''}</p>` : ''}
        ${result.later && hints() ? '<p class="later">⏳ Tohle rozhodnutí bude mít dohru.</p>' : ''}
        ${hints() ? `<div class="lesson">💡 ${item.lesson}</div>` : ''}
      </div>
      ${revealBlock(result.reveals)}`;
  }
  const showTrack = item.track && AP() === 'hybrid';
  return `
    <div class="card decision">
      <div class="decision-head"><span class="big-icon">${item.icon}</span><h3>${item.title}</h3>
        ${showTrack ? `<span class="tag ${item.track}">${TRACK_LABEL[item.track]}</span>` : ''}
      </div>
      ${item.echo ? `<div class="echo">⏳ <b>Následek dřívějšího rozhodnutí</b> (${item.fromTitle}, ${per().nom.toLowerCase()} ${item.fromSprint}): „${item.fromChoice}“</div>` : ''}
      <p class="situation">${item.text}</p>
      <div class="choices">${choices}</div>
      ${fb}
    </div>`;
}

function kickoffRules() {
  const t = S.sc.terms;
  if (AP() === 'pred' && !isPhased()) {
    return [
      `Zadání je <b>pevně dané</b> – ${t.contract}. Každá položka má jasnou hodnotu a priority dává smlouva (MoSCoW).`,
      'Na začátku každé etapy vyber z plánu položky do <b>kapacity týmu</b>. Hlídej návaznosti a milníky; milník se splní, když udržíš harmonogram.',
      'Během každé etapy přijde <b>událost</b>. V polovině projektu tě čeká <b>kontrolní bod</b>.',
    ];
  }
  if (AP() === 'pred') {
    const ph = S.sc.phases;
    return [
      `Projekt má ${ph.length} etapy různé délky (${ph.map(p => p.days).join(', ')} pracovních dní). Plánuje se <b>po vlnách</b>: budoucí etapy znáš jen nahrubo (délka, odhad práce v MD, milník), nejbližší etapu naplánuješ podrobně v <b>Ganttu</b>.`,
      'V Ganttu kliknutím nastavíš začátek každého úkolu a vyznačíš <b>závislosti</b> – po kterých úkolech smí začít. Hlídej, kolik lidí je který den potřeba: tým má omezenou velikost.',
      '<b>Skutečné závislosti</b> se ukážou až během etapy. Když úkol začne dřív, než skončí jeho předchůdce, práce se přeruší a den se dělá znovu. Přetížený tým etapu natáhne.',
      hasPlanning() ? 'Tvůj nástroj pro harmonogram umí úkoly jedním kliknutím <b>seřadit co nejdřív podle závislostí</b>.' : '⚠️ Bez praktiky pro harmonogram musíš všechno rozvrhnout ručně.',
      has('cpm') ? 'Analýza kritické cesty ukáže <b>kritické úkoly a vůli</b> ostatních.' : 'Bez analýzy kritické cesty nevidíš, které úkoly nesmí sklouznout.',
      ph.some(p => p.window)
        ? `Etapy jsou <b>výluky</b>: co se ve výluce nestihne, přesune se do další a stojí to 😊 i 💰. Rezervu projektu (${days(S.buffer)}) čerpá jen poslední výluka.`
        : `Co se nevejde do délky etapy, ukrojí z <b>rezervy projektu (${days(S.buffer)})</b>. Když dojde, každý další den stojí 📅 i 💰.`,
      ...(ph.some(p => typeof p.crew === 'object') ? ['Tým má <b>několik profesí</b> (dělníci, svářeči, jeřáb) a každá má vlastní kapacitu – hlídej každou zvlášť.'] : []),
      ...(ph.some(p => p.tasks.some(t => t.holdDay)) ? ['Některé úkoly smí začít až v den, kdy přijede <b>inspektor nebo zkušebna 🔍</b>.'] : []),
      ...(ph.some(p => p.rough) ? ['Odhady budoucích etap <b>nahrubo bývají optimistické</b> – podrobný plán ukáže skutečnou pracnost.'] : []),
      'V každé etapě přijde <b>událost</b>; některé volby odemyká jen správná praktika. Po 2. etapě tě čeká <b>kontrolní den</b>.',
    ];
  }
  if (AP() === 'agile') {
    return [
      'Rozsah <b>není pevný</b>. Cílem je co nejvíc <b>skutečné hodnoty pro uživatele</b> – měří se trakce po 2., 4. a 6. sprintu.',
      'Na začátku sprintu vyber z backlogu položky do <b>kapacity týmu</b> (story pointy).',
      `Hodnota u položek je jen <b>odhad (hypotéza)</b> – skutečnost ukáže až dodání${has('lean') ? `, nebo ji <b>ověříš experimentem 🧪</b> (až ${expPerSprint()} za sprint)` : ''}.`,
      'Dodané funkce mohou odhalit <b>nové podněty od uživatelů</b> – backlog se vyvíjí.',
      'Během každého sprintu přijde <b>událost</b>. V polovině projektu tě čeká <b>demo day</b> pro investory.',
    ];
  }
  return [
    `<b>Prediktivně řízené prvky</b> (${t.predShort}) běží podle plánu. S tvým mixem se milníky splní, pokud udržíš <b>📅 Harmonogram ≥ ${milestoneThreshold()}</b>.`,
    '<b>Agilně řízené prvky</b>: na začátku každého sprintu vyber z backlogu položky do <b>kapacity týmu</b> (story pointy). Kapacitu ovlivňuje morálka i tvůj mix praktik.',
    `Prioritizuj podle <b>MoSCoW</b>. Všechny <b>Must</b> položky musí být hotové do ${t.launch}.`,
    ...(S.sc.dependency ? [`Některé položky na sobě závisí – a ${S.sc.dependency.hint} Tady se oba přístupy v jednom projektu potkávají!`] : ['Některé položky na sobě závisí. Integrační milník ověří, že prediktivně i agilně řízené části do sebe zapadají.']),
    'Během každého sprintu přijde <b>událost</b>. Některé volby odemyká jen správná praktika. V polovině projektu tě čeká <b>stage gate</b>.',
  ];
}

function kickoff() {
  return `
    <div class="phase-title"><span class="phase">Fáze 3 / 3</span><h2>Realizace: ${periods()} ${periods() <= 4 ? per().few : per().many} do cíle</h2></div>
    ${timeline()}
    <div class="card">
      <h3>Jak to funguje</h3>
      <ul class="rules">
        ${kickoffRules().map(r => `<li>${r}</li>`).join('')}
        <li>Tvůj mix praktik působí celou dobu – a ${hints() ? 'postupně odhalíš' : 'až na konci uvidíš'}, jaké <b>vzorce a antivzorce</b> v projektu vytvořil.</li>
        ${isInsane() ? insaneRules() : ''}
        ${isHard() ? `<li class="hard-rule">🔥 <b>Náročná úroveň:</b> rozpočet režie jen ${budget()} bodů, ukazatele začínají na ${HARD.startMetric} a projekt končí už při poklesu na ${HARD.failAt}. Po ${gateAfter()}. ${per().gen === 'etapy' ? 'etapě' : 'sprintu'} se <b>změní kontext</b> a odhalí se skrytý faktor – pak můžeš přeskládat mix. Některá rozhodnutí se <b>vrátí později</b>.</li>` : ''}
      </ul>
      <button class="btn primary" data-action="toPlan">Na plánování 1. ${per().gen} ▶</button>
    </div>`;
}

function insaneRules() {
  const sc = S.sc;
  const rules = [
    '<b>Bez nápověd:</b> nikdo ti neřekne, jestli byla volba dobrá, jak praktiky působí ani které vzorce v projektu vznikají. Všechno se dozvíš až na konci.',
    '<b>Mlha reportingu:</b> ukazatele vidíš jen v rozmezí a o období zpožděné – pokud v mixu nemáš praktiku, která ukazuje skutečný stav projektu.',
    `<b>Stakeholdeři:</b> ${Object.keys(S.stake).length} strany s různými zájmy. Každá sleduje hlavně svou práci; když některá klesne na ${failAt()}, projekt končí.`,
    '<b>Projekt, nebo provoz?</b> Některé položky backlogu jsou rutina, která do projektu nepatří. Tlačítkem ⚙️ je předáš provozu – ale skutečná projektová práce tam nepatří.',
    '<b>Lidé a znalosti:</b> každý člověk umí jen některé oblasti. Práci, kterou nikdo neumí, dělá tým o polovinu pomaleji. Přetížení lidé vyhoří a odejdou – i se svými znalostmi.',
    '<b>Rok poté:</b> po konci projektu se ukáže, co z něj zbylo: kvalita, předání do provozu, znalosti, lidé a podpora stakeholderů. Započítá se do skóre.',
  ];
  if (sc.shifts) rules.push(`<b>Projekt mění tvář:</b> během projektu se ${sc.shifts.length}× změní jeho povaha. Pokaždé můžeš přeskládat mix praktik.`);
  if (sc.takeover) rules.push('<b>Převzatý projekt:</b> na dokončení máš jen zbytek projektu – a dědíš to, co předchozí vedení rozbilo.');
  return `<li class="hard-rule insane-rule">🤯 <b>Nemožná úroveň</b> – ukazatele končí už při poklesu na ${failAt()}, rozpočet režie je ${budget()} bodů.<ol>${rules.map(r => `<li>${r}</li>`).join('')}</ol></li>`;
}

function signed(n) { return n > 0 ? `+${n}` : String(n); }

function days(n) {
  const a = Math.abs(n);
  return `${n} ${a === 1 ? 'den' : a >= 2 && a <= 4 ? 'dny' : 'dní'}`;
}

function itemBadge(it) {
  return `<span class="mos m-${it.moscow}" title="${MOSCOW[it.moscow].title}">${MOSCOW[it.moscow].label}</span>`;
}

function itemValueLabel(it) {
  if (valueKnown(it)) return `💎 ${itemValue(it)}${it.actual !== undefined ? ' ✓' : ''}`;
  return `💎 ~${it.value}`;
}

function plan() {
  const cap = capacity();
  const used = selectedSP();
  const pct = Math.min(100, Math.round(used / cap * 100));
  const over = used > cap;
  const order = { M: 0, S: 1, C: 2, W: 3 };
  const items = S.backlog.slice().sort((a, b) => (a.done - b.done) || (order[a.moscow] - order[b.moscow]));
  const canExperiment = has('lean') && S.experiments < expPerSprint();
  const rows = items.map(it => {
    const lock = itemLock(it);
    const sel = S.selected.includes(it.id);
    const exp = has('lean') && !it.done && !valueKnown(it)
      ? `<button class="exp-btn" data-action="experiment" data-id="${it.id}" ${canExperiment ? '' : 'disabled'} title="Ověřit skutečnou hodnotu levným experimentem (landing page, rozhovory)">🧪 ověřit</button>` : '';
    const ops = isInsane() && !it.done
      ? `<button class="exp-btn ops-btn" data-action="handover" data-id="${it.id}" title="Předat liniové organizaci – v projektu se dělat nebude">⚙️ do provozu</button>` : '';
    const sp = itemSP(it);
    const owner = it.owner && S.stake[it.owner] !== undefined ? stakeholderById(it.owner).icon : '';
    const area = it.area && S.sc.areas ? `<small class="area ${knowers(it.area).length ? '' : 'unknown'}">${areaLabel(it.area)}${knowers(it.area).length ? '' : ' – nikdo neumí'}</small>` : '';
    return `
      <div class="bl-row">
        <button class="bl-item ${it.done ? 'done' : ''} ${lock && !it.done ? 'locked' : ''} ${sel ? 'sel' : ''}" data-action="toggle" data-id="${it.id}" ${lock ? 'disabled' : ''} title="${lock || MOSCOW[it.moscow].title}">
          <span class="check">${it.done ? '✔' : sel ? '☑' : lock ? '🔒' : '☐'}</span>
          ${itemBadge(it)}
          <span class="bl-name">${owner ? `<span class="owner" title="${stakeholderById(it.owner).name}">${owner}</span> ` : ''}${it.name}${area}${lock && !it.done ? `<small>${lock}</small>` : ''}</span>
          <span class="sp ${sp > it.sp ? 'over' : ''}">${sp} SP</span>
          <span class="val" title="Hodnota pro uživatele">${itemValueLabel(it)}</span>
        </button>${exp}${ops}
      </div>`;
  }).join('');
  const mustLeft = S.backlog.filter(b => b.moscow === 'M' && !b.done).length;
  const parts = [
    ['Základ', baseCapacity()],
    ['Morálka', moraleCapacity()],
    ['Mix praktik', practiceCapacity()],
    ['Události', S.capacityMod],
    ['Změna kontextu', S.shiftCapacity],
    ['Odchody z týmu', -S.teamLoss],
    ['Provoz v projektu', -S.opsOverhead],
  ].filter(([, v], i) => i === 0 || v);
  const listTitle = AP() === 'pred' ? 'Plán prací' : 'Product backlog';
  const hint = AP() === 'agile'
      ? `Klikni na položky, které tým ve sprintu udělá. 💎 ~ je jen odhad hodnoty – skutečnost ukáže dodání${has('lean') ? ' nebo experiment 🧪' : ''}.`
      : `Klikni na položky, které tým ${AP() === 'pred' ? 'v této etapě' : 'v tomto sprintu'} udělá. Pořadí kliknutí = priorita.`;
  const goal = AP() === 'agile'
    ? (() => { const next = S.sc.milestones.find(m => m.afterSprint >= S.sprint); return `<li>Dodaná hodnota zatím <b>${S.valueDelivered}</b>${next ? `, další cíl: ${next.icon} ${next.name} – ${next.target}` : ''}.</li>`; })()
    : `<li>Zbývá dokončit <b>${mustLeft}</b> Must položek (${per().nom.toLowerCase()} ${S.sprint} z ${periods()}).</li>`;
  return `
    <div class="phase-title"><span class="phase">${per().nom} ${S.sprint} z ${periods()}</span><h2>Plánování ${per().gen}</h2></div>
    ${timeline()}
    <div class="plan-grid">
      <div class="card backlog">
        <h3>${listTitle}</h3>
        <p class="hint">${hint}</p>
        ${rows}
      </div>
      <aside class="card side">
        <h3>Kapacita týmu</h3>
        <div class="cap-num ${over ? 'over' : ''}"><b>${used}</b> / ${cap} SP</div>
        <div class="bar cap ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>
        ${over ? '<p class="warn">⚠️ Přetížení! Tým nestihne vše a morálka i kvalita utrpí.</p>' : ''}
        ${has('lean') && AP() !== 'pred' ? `<p class="hint">🧪 Experimenty v tomto sprintu: ${S.experiments} / ${expPerSprint()}</p>` : ''}
        <ul class="facts">
          <li>Kapacita: ${parts.map(([l, v], i) => `${l} ${i ? signed(v) : v}`).join(', ')}.</li>
          ${goal}
        </ul>
        <button class="btn primary big" data-action="startSprint" ${S.selected.length || !S.backlog.some(b => !itemLock(b)) ? '' : 'disabled'}>Spustit ${per().acc} ${S.sprint} ▶</button>
      </aside>
    </div>
    ${teamPanel()}`;
}

const fatigueIcon = f => (f < 40 ? '🙂' : f < 60 ? '😐' : f < FATIGUE.warn ? '😓' : '🥵');

function teamPanel() {
  if (!S.team.length) return '';
  return `
    <div class="card team">
      <h3>👥 Tým</h3>
      <div class="team-grid">
        ${S.team.map(p => `
          <div class="person ${p.gone ? 'gone' : ''}">
            <span class="p-icon">${p.icon}</span>
            <span class="p-main"><b>${p.name}</b><small>${p.gone ? vf(p, 'odešel z projektu', 'odešla z projektu') : p.role}</small>
              <span class="knows">${p.knows.map(a => `<span class="${knowers(a).length === 1 && !p.gone ? 'solo' : ''}">${areaLabel(a)}</span>`).join('')}</span></span>
            <span class="p-fatigue" title="Únava">${p.gone ? '🚪' : `${fatigueIcon(p.fatigue)}<i class="fbar"><i style="width:${p.fatigue}%"></i></i>`}</span>
          </div>`).join('')}
      </div>
      <p class="hint">Únava roste prací v oblasti, kterou člověk umí (čím méně lidí ji umí, tím víc), přesčasy a přetížením. Kdo je vyčerpaný, odejde.</p>
    </div>`;
}

function event() {
  const c = S.current;
  const gateTitle = AP() === 'agile' ? 'Investoři rozhodují' : AP() === 'pred' ? 'Kontrolní den' : 'Řídicí výbor zasedá';
  return `
    <div class="phase-title"><span class="phase">${c.isGate ? 'Kontrolní bod' : `${per().nom} ${S.sprint} z ${periods()} · probíhá`}</span>
      <h2>${c.isGate ? gateTitle : c.event.echo ? 'Vrací se dřívější rozhodnutí…' : `Uprostřed ${per().gen} se něco stalo…`}</h2></div>
    ${choiceCard(c.event, c.result, 'eventPick')}
    ${c.result ? `<div class="actions"><button class="btn primary" data-action="eventNext">${c.isGate ? `Na plánování ${per().gen} ${S.sprint + 1} ▶` : `Na ${per().toReview} ▶`}</button></div>` : ''}
  `;
}

function deliveredRow(i) {
  if (i.actual === undefined) return `<li class="ok">✔ ${i.name} <small>${i.sp} SP · 💎 ${i.value}</small></li>`;
  const diff = i.actual - i.value;
  const mood = diff >= 3 ? '🎉' : diff <= -3 ? '😬' : '';
  return `<li class="ok">✔ ${i.name} <small>${i.sp} SP · odhad ~${i.value} → skutečnost <b>${i.actual}</b> ${mood}</small></li>`;
}

function review() {
  const r = S.review;
  const m = r.milestone;
  const last = S.sprint >= periods();
  const heading = { hybrid: 'Agilně řízené prvky: co tým dodal', pred: 'Co se v etapě dokončilo', agile: 'Co tým dodal' }[AP()];
  const msPrefix = { hybrid: '📐 Prediktivní milník', pred: '📐 Milník', agile: '🎯 Cíl trakce' }[AP()];
  const gateLabel = AP() === 'agile' ? 'Na demo day 🎤' : AP() === 'pred' ? 'Na kontrolní den 🔍' : 'Na stage gate 🚦';
  return `
    <div class="phase-title"><span class="phase">${per().nom} ${S.sprint} z ${periods()} · konec</span><h2>${per().review}</h2></div>
    ${timeline()}
    <div class="card">
      <h3>${heading}</h3>
      <p>Závazek <b>${r.committed} SP</b> při kapacitě <b>${r.cap} SP</b>${r.experiments ? ` · ověřené hypotézy: ${r.experiments}` : ''}.</p>
      <ul class="delivered">
        ${r.delivered.map(deliveredRow).join('')}
        ${r.unfinished.map(i => `<li class="ko">✖ ${i.name} <small>nedokončeno – zpět mezi nedodělané</small></li>`).join('')}
      </ul>
      ${r.notes.map(n => `<p>${n}</p>`).join('')}
      <div class="chips">${deltaChips(r.deltas)}${stakeChips(r.stakeDeltas)}</div>
      ${r.ongoing ? `
        <h4>Průběžný vliv tvého mixu</h4>
        ${hints() ? `<p class="hint">${r.ongoing.labels.join(' · ')}</p>` : '<p class="hint">Odkud se vlivy berou, musíš vyčíst sám/sama.</p>'}
        <div class="chips">${deltaChips(r.ongoing.deltas)}</div>` : ''}
      ${(r.teamNotes || []).length ? `<h4>👥 Tým</h4>${r.teamNotes.map(n => `<p class="team-note">${n}</p>`).join('')}` : ''}
      ${(r.signals || []).length ? `<div class="signals">${r.signals.map(n => `<p>${n}</p>`).join('')}</div>` : ''}
    </div>
    ${r.discovered.length ? `
      <div class="card discovered">
        <h3>🆕 Nové podněty od uživatelů</h3>
        ${r.discovered.map(d => `<p><b>${d.name}</b> – ${d.why}</p>`).join('')}
        <p class="hint">Položky přibyly do backlogu.</p>
      </div>` : ''}
    ${m ? `
      <div class="card milestone ${m.ok ? 'ok' : 'late'}">
        <h3>${msPrefix}: ${m.icon} ${m.name} ${m.ok ? '✓' : '– problém'}</h3>
        <p>${m.text}</p>
        ${Object.keys(m.deltas).length ? `<div class="chips">${deltaChips(m.deltas)}</div>` : ''}
      </div>` : ''}
    ${revealBlock(r.reveals)}
    <div class="actions"><button class="btn primary" data-action="reviewNext">${last ? (isInsane() ? 'Konec projektu – a co dál? 📆' : 'Vyhodnotit projekt 🏁') : S.sprint === gateAfter() && !S.gateDone ? gateLabel : pendingShiftIdx() >= 0 ? 'Něco se mění… 🦎' : `Na plánování ${per().gen} ${S.sprint + 1} ▶`}</button></div>
  `;
}

// ---------- Vykreslení: Gantt a etapy ----------

const roughMD = ph => `~${Math.round((ph.rough ?? phaseMD(ph)) / 5) * 5} MD`;
const skillLabel = k => (SKILLS[k] || SKILLS.lide);
const crewText = crew => Object.entries(crew).map(([k, n]) => `${skillLabel(k).icon} ${n} ${skillLabel(k).label.toLowerCase()}`).join(' · ');

function phaseTimeline() {
  const phases = S.sc.phases;
  const [top, bottom] = TIMELINE_LABELS.pred;
  const cols = phases.map(p => `${p.days}fr`).join(' ');
  const ms = phases.map((p, i) => {
    const st = S.milestones[p.id] || 'pending';
    return `<div class="ms ${st}" style="grid-column:${i + 1}"><span class="diamond">◆</span>${p.milestone.icon} ${p.milestone.name}${st === 'late' ? ' (zpoždění)' : st === 'ok' ? ' ✓' : ''}</div>`;
  }).join('');
  const cells = phases.map((p, i) => {
    const n = i + 1;
    const res = S.phaseResults[i];
    const cls = n < S.sprint ? 'past' : n === S.sprint ? 'now' : 'future';
    const detail = n < S.sprint && res ? (res.carried ? `nestihlo se ${res.carried} úkolů` : `skutečně ${res.finish} z ${p.days} dní`)
      : n === S.sprint ? `${p.days} dní · podrobný Gantt` : `${p.days} dní · nahrubo ${roughMD(p)}`;
    return `<div class="sprint-cell phase-cell ${cls}" title="${p.goal}">${n}. ${p.name}<small>${detail}</small></div>`;
  }).join('');
  return `
    <section class="timeline" aria-label="Plán po etapách">
      <div class="track-label">${top[0]} <small>${top[1]}</small></div>
      <div class="track pred" style="grid-template-columns:${cols}">${ms}</div>
      <div class="track-label">${bottom[0]} <small>${bottom[1]}</small></div>
      <div class="track agile" style="grid-template-columns:${cols}">${cells}</div>
    </section>`;
}

// Mřížka Ganttu (plánování i plán vs. skutečnost).
function ganttGrid(tasks, gridDays, phaseDays, rowFn, footer) {
  const holds = new Set(tasks.filter(t => t.holdDay).map(t => t.holdDay));
  const head = Array.from({ length: gridDays }, (_, i) => i + 1)
    .map(d => `<div class="g-day ${d > phaseDays ? 'out' : ''} ${d === phaseDays ? 'end' : ''}" ${holds.has(d) ? 'title="Inspekce / zkušebna"' : ''}>${holds.has(d) ? '🔍' : d}</div>`).join('');
  return `
    <div class="gantt-wrap">
      <div class="gantt" style="--days:${gridDays}">
        <div class="g-row g-head"><div class="g-task">Úkol</div><div class="g-deps">Začíná po</div><div class="g-days">${head}</div></div>
        ${tasks.map(rowFn).join('')}
        ${footer || ''}
      </div>
    </div>`;
}

function usageRows(tasks, startOf, gridDays, phaseDays, crew) {
  return Object.entries(crew).map(([k, n]) => {
    const use = usage(tasks, startOf, {}, Object.keys(crew).length > 1 || k !== 'lide' ? k : null);
    const cells = Array.from({ length: gridDays }, (_, i) => {
      const u = use[i + 1] || 0;
      return `<div class="g-use ${u > n ? 'over' : ''} ${i + 1 > phaseDays ? 'out' : ''}">${u || ''}</div>`;
    }).join('');
    const lbl = skillLabel(k);
    return `<div class="g-row g-foot"><div class="g-task"><b>${lbl.icon} ${lbl.label} na den</b><small>k dispozici ${n}</small></div><div class="g-deps"></div><div class="g-days">${cells}</div></div>`;
  }).join('');
}

function ganttPlan() {
  const ph = phase();
  const tasks = phaseTasks();
  const g = S.gantt;
  const gridDays = ph.days + GANTT_EXTRA_DAYS;
  const ev = evaluateGantt();
  const conflictIds = new Set([...ev.declaredConflicts, ...ev.holdConflicts].map(t => t.id));
  const cp = has('cpm') ? criticalInfo(tasks, g.deps) : null;
  const multi = Object.keys(ev.crew).length > 1;
  const row = t => {
    const s = g.starts[t.id];
    const e = taskEnd(s, t);
    const cells = Array.from({ length: gridDays }, (_, i) => {
      const d = i + 1;
      const inBar = d >= s && d <= e;
      const cls = [inBar ? 'in' : '', inBar && conflictIds.has(t.id) ? 'conflict' : '', inBar && cp && cp.critical.has(t.id) ? 'crit' : '',
        inBar && t.carried ? 'carried' : '', d > ph.days ? 'out' : '', d === ph.days ? 'end' : '', t.holdDay === d ? 'hold' : ''].join(' ');
      return `<button class="g-cell ${cls}" data-action="ganttStart" data-task="${t.id}" data-day="${d}" title="${t.id}: začít dnem ${d}">${inBar && d === s ? t.id : !inBar && t.holdDay === d ? '🔍' : ''}</button>`;
    }).join('');
    const chips = tasks.filter(o => o.id !== t.id).map(o => `
      <button class="dep ${g.deps[t.id].includes(o.id) ? 'on' : ''}" data-action="ganttDep" data-task="${t.id}" data-dep="${o.id}" title="${t.id} smí začít až po skončení ${o.id}">${o.id}</button>`).join('');
    const cpNote = cp ? (cp.critical.has(t.id) ? '<span class="crit-tag">⚑ kritická cesta</span>' : `<span class="float-tag">vůle ${days(cp.float[t.id])}</span>`) : '';
    const sk = skillLabel(taskSkill(t));
    return `
      <div class="g-row ${conflictIds.has(t.id) ? 'has-conflict' : ''}">
        <div class="g-task"><b class="g-id ${t.carried ? 'carried' : ''}">${t.id}</b> ${t.name}
          <small>${days(t.days)} · ${t.people} ${sk.icon}${multi ? ` ${sk.label.toLowerCase()}` : ''} · ${taskMD(t)} MD ${cpNote}</small>
          ${t.holdDay ? `<small class="hold-note">🔍 nejdřív ${t.holdDay}. den</small>` : ''}
          <small class="note">${t.note}</small></div>
        <div class="g-deps">${chips}</div>
        <div class="g-days">${cells}</div>
      </div>`;
  };
  const slack = ph.days - ev.finish;
  const planMD = sum(tasks, taskMD);
  const roughNote = ph.rough && S.sprint > 1 ? `<p class="rough-note">📏 Odhad nahrubo byl ${roughMD(ph)}, podrobný plán má <b>${planMD} MD</b> (${planMD >= ph.rough ? '+' : ''}${Math.round((planMD / ph.rough - 1) * 100)} %). Hrubé odhady bývají optimistické.</p>` : '';
  const carryNote = S.carryIn.length ? `<p class="warn">🚧 Z minulé výluky se přesunulo: ${S.carryIn.map(t => t.name).join(', ')}.</p>` : '';
  return `
    <div class="phase-title"><span class="phase">${per().nom} ${S.sprint} z ${periods()}</span><h2>Podrobný plán: ${ph.name}</h2>
      <p>${ph.goal} Cíl: ${ph.milestone.icon} <b>${ph.milestone.name}</b>.${ph.window ? ' Je to <b>výluka</b> – co se nestihne, čeká na další.' : ''}</p></div>
    ${phaseTimeline()}
    <div class="card">
      ${roughNote}${carryNote}
      <div class="gantt-stats">
        <div><span>Délka ${ph.window ? 'výluky' : 'etapy'}</span><b>${days(ph.days)}</b>${S.phaseDelay ? `<small class="warn">zdržení ${days(S.phaseDelay)}</small>` : ''}</div>
        <div class="${slack < 0 ? 'bad' : slack === 0 ? 'warn' : 'good'}"><span>Plán končí</span><b>dnem ${ev.finish}</b><small>${slack >= 0 ? `vůle ${days(slack)}` : `přesah ${days(-slack)}`}</small></div>
        <div><span>Práce</span><b>${planMD} MD</b><small>${crewText(ev.crew)}</small></div>
        <div class="${conflictIds.size ? 'bad' : 'good'}"><span>Konflikty</span><b>${conflictIds.size}</b><small>závislosti${tasks.some(t => t.holdDay) ? ' a inspekce' : ''}</small></div>
        <div class="${ev.overDays ? 'bad' : 'good'}"><span>Přetížení týmu</span><b>${days(ev.overDays)}</b></div>
        <div class="${S.buffer < 0 ? 'bad' : S.buffer === 0 ? 'warn' : ''}"><span>Rezerva projektu</span><b>${days(S.buffer)}</b></div>
      </div>
      <p class="hint">Klikni v řádku úkolu na den, kdy má začít. Ve sloupci <b>Začíná po</b> vyznač, po kterých úkolech smí začít. Dole vidíš, kolik lidí${multi ? ' každé profese' : ''} je který den potřeba. Skutečné závislosti se ukážou až během ${per().gen} – odvoď je z popisu práce.</p>
      ${ganttGrid(tasks, gridDays, ph.days, row, usageRows(tasks, t => g.starts[t.id], gridDays, ph.days, ev.crew))}
      <div class="actions">
        ${hasPlanning() ? '<button class="btn" data-action="ganttAuto">⏩ Seřadit co nejdřív podle závislostí</button>' : '<span class="hint">S praktikou pro harmonogram by úkoly seřadil nástroj.</span>'}
        <button class="btn primary big" data-action="startPhase">Spustit ${per().acc} ${S.sprint} ▶</button>
      </div>
    </div>`;
}

function phaseReview() {
  const r = S.review;
  const ph = r.phase;
  const tasks = r.tasks;
  const gridDays = Math.max(ph.days, r.sim.finish, r.plan.finish) + 1;
  const byId = byTaskId(tasks);
  const row = t => {
    const ps = r.starts[t.id];
    const pe = taskEnd(ps, t);
    const a = r.sim.actual[t.id];
    const cells = Array.from({ length: gridDays }, (_, i) => {
      const d = i + 1;
      const cls = [d >= ps && d <= pe ? 'plan' : '', d >= a.start && d <= a.end ? 'act' : '', a.rework && d === a.end ? 'rework' : '',
        d > ph.days ? 'out' : '', d === ph.days ? 'end' : ''].join(' ');
      return `<div class="g-cell ro ${cls}">${d === a.start ? t.id : ''}</div>`;
    }).join('');
    const truth = t.deps.length ? t.deps.join(', ') : '–';
    const waitedHold = t.holdDay && ps < t.holdDay;
    return `
      <div class="g-row">
        <div class="g-task"><b class="g-id ${t.carried ? 'carried' : ''}">${t.id}</b> ${t.name}<small>${a.rework ? '⚠️ přerušeno, den navíc' : waitedHold ? `🔍 čekal na inspekci (${t.holdDay}. den)` : a.waitedForPeople ? `👷 čekal na volné lidi (${days(a.waitedForPeople)})` : a.start > ps ? `čekal na předchůdce (${days(a.start - ps)})` : '✓ podle plánu'}</small></div>
        <div class="g-deps"><small>skutečně po: <b>${truth}</b></small></div>
        <div class="g-days">${cells}</div>
      </div>`;
  };
  const causes = [
    ...r.sim.rework.map(t => {
      const pred = t.deps.find(d => r.starts[t.id] <= taskEnd(r.starts[d], byId[d]));
      return `⚠️ <b>${t.id} ${t.name}</b> začal dřív, než skončil <b>${pred} ${byId[pred].name}</b> – práce se přerušila a den se dělal znovu.`;
    }),
    ...r.plan.holdConflicts.map(t => `🔍 <b>${t.id} ${t.name}</b> byl naplánovaný před příjezdem inspektora/zkušebny (${t.holdDay}. den) – musel čekat.`),
    ...(r.plan.missed.length && !r.sim.rework.length ? [`Nevyznačil(a) jsi ${r.plan.missed.length} skutečnou závislost(i), ale plán je náhodou dodržel.`] : []),
    ...(r.plan.extra.length ? [`Zbytečné vazby: ${r.plan.extra.map(([d, t]) => `${t} po ${d}`).join(', ')} – úkoly mohly běžet souběžně.`] : []),
    ...(r.sim.waited.length ? [`👷 Plán počítal s víc lidmi, než tým má (${days(r.sim.overDays)} přetížení). Úkoly ${r.sim.waited.map(t => t.id).join(', ')} musely čekat, až se lidé uvolní.`] : []),
    ...(r.sim.delay ? [`📅 Zdržení z událostí a okolností: ${days(r.sim.delay)}.`] : []),
    ...(r.carry.length ? [`🚧 Ve výluce se nestihlo: ${r.carry.map(t => t.name).join(', ')}. Práce se přesouvá do další výluky.`] : []),
  ];
  const evm = has('evm') ? `<p>📈 <b>EVM:</b> plánovaná práce ${r.plannedMD} MD, skutečná ${r.actualMD} MD · CPI ≈ ${(r.plannedMD / r.actualMD).toFixed(2)} · SPI ≈ ${(Math.min(ph.days, r.plan.finish) / r.sim.finish).toFixed(2)}</p>` : '';
  const last = S.sprint >= periods();
  const msText = r.windowed
    ? (r.late ? `Výluka skončila s nedodělky (${r.carry.length}). Přesouvají se do další výluky.` : 'Výluka skončila podle plánu.')
    : r.overrun ? `${per().nom} přetáhla o ${days(r.overrun)}${r.buffer >= 0 ? ', zatím to pokryla rezerva projektu.' : ' a rezerva projektu nestačila.'}` : `${per().nom} skončila v plánované délce.`;
  return `
    <div class="phase-title"><span class="phase">${per().nom} ${S.sprint} z ${periods()} · konec</span><h2>Kontrola: ${ph.name}</h2></div>
    ${phaseTimeline()}
    <div class="card">
      <div class="gantt-stats">
        <div><span>Plán</span><b>dnem ${r.plan.finish}</b></div>
        <div class="${r.late ? 'bad' : 'good'}"><span>Skutečnost</span><b>dnem ${r.sim.finish}</b><small>z ${days(ph.days)}</small></div>
        <div class="${r.buffer < 0 ? 'bad' : r.buffer === 0 ? 'warn' : ''}"><span>Rezerva projektu</span><b>${days(r.buffer)}</b>${!r.windowed && r.overrun ? `<small>čerpáno ${days(r.overrun)}</small>` : ''}</div>
      </div>
      <p class="hint">Obrys = tvůj plán, plná barva = skutečnost. Teď vidíš i skutečné závislosti.</p>
      ${ganttGrid(tasks, gridDays, ph.days, row)}
      ${causes.length ? `<ul class="causes">${causes.map(c => `<li>${c}</li>`).join('')}</ul>` : '<p class="good-note">✅ Proběhlo přesně podle plánu.</p>'}
      ${evm}
      ${r.beyond ? `<p class="warn">Rezerva projektu je vyčerpaná – ${days(r.beyond)} navíc stojí harmonogram i peníze.</p>` : ''}
      <div class="chips">${deltaChips(r.deltas)}</div>
      ${r.ongoing ? `<h4>Průběžný vliv tvého mixu</h4><p class="hint">${r.ongoing.labels.join(' · ')}</p><div class="chips">${deltaChips(r.ongoing.deltas)}</div>` : ''}
    </div>
    <div class="card milestone ${r.late ? 'late' : 'ok'}">
      <h3>📐 Milník: ${ph.milestone.icon} ${ph.milestone.name} ${r.late ? '– se zpožděním' : '✓'}</h3>
      <p>${msText}</p>
    </div>
    ${revealBlock(r.reveals)}
    <div class="actions"><button class="btn primary" data-action="reviewNext">${last ? 'Vyhodnotit projekt 🏁' : S.sprint === gateAfter() && !S.gateDone ? 'Na kontrolní den 🔍' : `Na plánování ${per().gen} ${S.sprint + 1} ▶`}</button></div>
  `;
}

// ---------- Vykreslení: změna kontextu ----------

function shift() {
  const sh = curShift();
  const r = S.reshape;
  const res = S.shiftResult;
  const adds = reshapeAdds();
  const cost = sum(r.mix.map(practiceById), p => p.cost);
  const over = cost - budget();
  const card = p => {
    const on = r.mix.includes(p.id);
    const orig = r.original.includes(p.id);
    const cls = [on ? 'on' : '', on && !orig ? 'added' : '', !on && orig ? 'removed' : ''].join(' ');
    const disabled = res || (!on && !orig && adds.length >= maxShiftAdds());
    return `<button class="reshape-card ${cls}" data-action="reshapeToggle" data-id="${p.id}" ${disabled ? 'disabled' : ''} title="${p.desc}">
      <span>${p.icon}</span><b>${p.name}</b><small>${p.cost ? '●'.repeat(p.cost) : 'zdarma'}</small>
      ${on && !orig ? '<em>nově</em>' : !on && orig ? '<em>odebráno</em>' : ''}</button>`;
  };
  const cols = Object.keys(WORLD_LABEL).map(w => `
    <div class="pcol"><h3>${WORLD_LABEL[w]}</h3>${PRACTICES.filter(p => p.world === w).map(card).join('')}</div>`).join('');
  const changes = [
    ...(r.devalued.length ? [`📉 Ztratily hodnotu: ${r.devalued.map(b => b.name).join(', ')}.`] : []),
    ...(r.added.length ? [`🆕 Přibyla práce: ${r.added.map(b => b.name).join(', ')}.`] : []),
    ...(sh.capacityLoss ? [`⏳ Kapacita týmu je do konce projektu nižší o ${sh.capacityLoss}.`] : []),
    ...(sh.approach && sh.approach !== r.prevApproach ? [`${APPROACHES[sh.approach].icon} Z projektu je teď <b>${APPROACHES[sh.approach].label.toLowerCase()}</b> (dosud ${APPROACHES[r.prevApproach].label.toLowerCase()}).`] : []),
    ...(sh.addStakeholders || []).map(id => { const x = stakeholderById(id); return `${x.icon} Nový stakeholder: <b>${x.name}</b> – ${x.wants}`; }),
    ...r.teamNotes,
  ];
  const result = res && !hints() ? `
    <div class="card mix-result">
      <h3>Mix je upravený</h3>
      <p>Přidáno: ${res.adds.map(id => `${practiceById(id).icon} ${practiceById(id).name}`).join(', ') || 'nic'} · odebráno: ${res.removed.map(id => `${practiceById(id).icon} ${practiceById(id).name}`).join(', ') || 'nic'}</p>
      <div class="chips">${deltaChips(res.deltas)}</div>
      <p class="hint">Jestli úprava odpovídá nové situaci, ukáže projekt.</p>
      <button class="btn primary" data-action="shiftNext">Na plánování ${per().gen} ${S.sprint + 1} ▶</button>
    </div>` : res ? `
    <div class="card mix-result ${res.adapted ? 'adapted' : 'rigid'}">
      <h3>${res.adapted ? '✅ Řízení jsi přizpůsobil(a) nové situaci' : '❌ Metodika zůstala stejná, i když se svět změnil'}</h3>
      <p>${sh.lesson}</p>
      ${res.hiddenFits.length ? `<p>🎯 Na odhalený faktor sedí: ${res.hiddenFits.map(p => `${p.icon} ${p.name}`).join(', ')}.</p>` : ''}
      ${res.newBad.length ? `<p class="warn">⚠️ Nově přidané, ale tady nevhodné: ${res.newBad.map(p => `${p.icon} ${p.name}`).join(', ')}.</p>` : ''}
      <div class="chips">${deltaChips(res.deltas)}</div>
      ${revealBlock(res.reveals)}
      <button class="btn primary" data-action="shiftNext">Na plánování ${per().gen} ${S.sprint + 1} ▶</button>
    </div>` : `
    <div class="mix-bar card">
      <div class="mix-cost">
        <span>Režie řízení</span>
        <b class="${over > 0 ? 'over' : ''}">${cost} / ${budget()}</b>
        <small>Přidáno ${adds.length} / ${maxShiftAdds()}</small>
      </div>
      <div class="mix-pairs"><p class="hint">Každá nově zavedená praktika stojí −3 💰 a −2 💪 (změna procesu uprostřed projektu). Odebrat můžeš cokoli zdarma.</p></div>
      <button class="btn primary big" data-action="confirmShift">Potvrdit úpravu mixu ▶</button>
    </div>`;
  return `
    <div class="phase-title"><span class="phase">${isInsane() ? '🤯' : '🔥'} Změna kontextu · po ${per().gen === 'etapy' ? 'etapě' : 'sprintu'} ${S.sprint}</span><h2>${sh.icon} ${sh.title}</h2></div>
    <div class="card shift-card">
      <p class="situation">${sh.text}</p>
      ${changes.length ? `<ul class="causes">${changes.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}
      <div class="ctx-row"><b>Kontext teď:</b> ${contextChips()}</div>
      <div class="lesson">🔄 Tvůj mix praktik byl nastavený pro původní situaci. Zvaž, které praktiky nová situace vyžaduje – a které už nedávají smysl.</div>
    </div>
    ${res ? '' : `<div class="pgrid reshape">${cols}</div>`}
    ${result}`;
}

// ---------- Vykreslení: nemožná úroveň ----------

function diagnose() {
  const to = S.sc.takeover;
  const d = S.diag;
  const truth = takeoverTruth();
  if (!d.candidates) d.candidates = shuffle([...truth, ...to.distractors]);
  const cards = d.candidates.map(id => {
    const p = PATTERNS.find(x => x.id === id);
    const on = d.picks.includes(id);
    return `<button class="diag-card ${on ? 'on' : ''}" data-action="diagPick" data-id="${id}" ${d.result ? 'disabled' : ''}>
      <span class="pattern-icon">${p.icon}</span><b>${p.name}</b><small>${p.m}</small></button>`;
  }).join('');
  return `
    <div class="phase-title"><span class="phase">Fáze 1 / 3</span><h2>Diagnóza: co se v projektu děje?</h2>
      <p>${to.situation}</p></div>
    <div class="card">
      <h3>🩺 Co vidíš v prvním týdnu</h3>
      <ul class="symptoms">${d.symptoms.map(x => `<li>${x}</li>`).join('')}</ul>
      <p class="hint">Příznaky jsou <b>důsledky</b>. Najdi <b>mechanismy</b>, které je způsobují – antivzorce, které předchozí vedení do projektu zavedlo. Pozor, ne všechny nabízené v projektu působí.</p>
    </div>
    <div class="diag-grid">${cards}</div>
    ${d.result ? `
      <div class="card result">
        <h3>Diagnóza je zapsaná</h3>
        <p>Označil(a) jsi ${d.picks.length} ${d.picks.length === 1 ? 'antivzorec' : d.picks.length <= 4 ? 'antivzorce' : 'antivzorců'}. Jestli jsi trefil(a) skutečné příčiny, se ukáže až na konci – teď podle diagnózy zasáhni do mixu praktik.</p>
        <button class="btn primary" data-action="toToolbox">Na zásah do mixu ▶</button>
      </div>` : `
      <div class="actions"><button class="btn primary" data-action="diagEval" ${d.picks.length ? '' : 'disabled'}>Potvrdit diagnózu (${d.picks.length})</button></div>`}`;
}

function epilog() {
  const e = S.epilog;
  return `
    <div class="phase-title"><span class="phase">Projekt skončil</span><h2>📆 Rok poté</h2>
      <p>Projekt je předaný a tým se rozešel k dalším úkolům. Co z něj zůstalo?</p></div>
    <div class="epilog-list">
      ${e.cards.map(c => `
        <div class="card epilog-card ${c.pts > 0 ? 'good' : c.pts < 0 ? 'bad' : ''}">
          <span class="ep-when">${c.when}</span>
          <h3>${c.icon} ${c.title}</h3>
          <p>${c.text}</p>
          <span class="ep-pts">${c.pts > 0 ? `+${c.pts}` : c.pts || '±0'}</span>
        </div>`).join('')}
    </div>
    <div class="card result">
      <h3>Udržitelnost výsledku: ${e.sustain} %</h3>
      <p class="hint">Projekt nekončí předáním. To, jestli jeho výsledek po roce žije, rozhoduje kvalita, předání do provozu, znalosti v týmu, odpočatí lidé a podpora stakeholderů.</p>
      <button class="btn primary big" data-action="epilogNext">Celkové vyhodnocení 🏁</button>
    </div>`;
}

// Na konci nemožné úrovně se ukáže, co bylo během hry skryté.
function insaneReveal() {
  if (!isInsane()) return '';
  const r = S.mixResult;
  const stakes = Object.entries(S.stake).map(([id, v]) => { const x = stakeholderById(id); return `<li>${x.icon} <b>${x.name}</b>: ${moodIcon(v)} ${v}</li>`; }).join('');
  return `
    <div class="card">
      <h3>🌫️ Co se skrývalo v mlze</h3>
      <div class="two-col">
        <div>
          <h4>Skutečné ukazatele na konci</h4>
          <ul class="checklist">${METRICS.map(m => `<li>${m.icon} ${m.label}: <b>${S.metrics[m.id]}</b></li>`).join('')}</ul>
          ${stakes ? `<h4>Stakeholdeři</h4><ul class="checklist">${stakes}</ul>` : ''}
        </div>
        <div>
          ${r ? `<h4>Základy pro ${APPROACHES[AP()].label.toLowerCase()} v tvém mixu</h4>
          <ul class="checklist">${ESSENTIALS[AP()].map(e => `<li class="${e.any.some(has) ? 'ok' : 'ko'}">${e.any.some(has) ? '✅' : '❌'} ${e.name}</li>`).join('')}</ul>
          ${chosenPractices().filter(p => isTrap(p) || isMisfit(p)).length ? `<p class="warn">⚠️ Pro tento typ projektu nevhodné: ${chosenPractices().filter(p => isTrap(p) || isMisfit(p)).map(p => `${p.icon} ${p.name}`).join(', ')}</p>` : ''}` : ''}
          ${S.team.length ? `<h4>Tým na konci</h4><ul class="checklist">${S.team.map(p => `<li>${p.icon} ${p.name}: ${p.gone ? `🚪 ${vf(p, 'odešel', 'odešla')}` : `${fatigueIcon(p.fatigue)} únava ${p.fatigue}`}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    </div>`;
}

function finalScore() {
  const avgMetrics = sum(METRICS, m => S.metrics[m.id]) / METRICS.length;
  const value = sum(S.backlog.filter(b => b.done), itemValue);
  // Prediktivní projekt: hodnotí se dodání v termínu (čerpání rezervy mírně, přetažení výrazně).
  const valuePct = isPhased()
    ? Math.max(0, 100 - 5 * Math.min(S.overrunTotal, S.initialBuffer) - 15 * Math.max(0, -S.buffer))
    : Math.min(100, value / S.targetValue * 100);
  const insightPct = S.insightMax ? S.insight / S.insightMax * 100 : 0;
  // Nemožná úroveň: do zdraví projektu se počítá i nejméně spokojený stakeholder a do skóre rok poté.
  const min = stakeMin();
  const health = min === null ? avgMetrics : avgMetrics * 0.8 + min * 0.2;
  const sustain = S.epilog ? S.epilog.sustain : null;
  let score;
  if (S.failed) score = Math.min(35, health * 0.35);
  else if (sustain !== null) score = health * 0.25 + valuePct * 0.25 + insightPct * 0.3 + sustain * 0.2;
  else score = health * 0.35 + valuePct * 0.3 + insightPct * 0.35;
  return { avgMetrics: health, value, valuePct, insightPct, sustain, score: Math.round(score) };
}

function grade(score) {
  if (score >= 85) return ['🏆', 'Mistr řízení projektů', 'Projekt jsi řídil(a) přesně tak, jak jeho povaha vyžadovala.'];
  if (score >= 70) return ['🥇', 'Zkušený projektový manažer', 'Velmi dobrá práce. Pár rozhodnutí šlo udělat lépe – mrkni na poučení níže.'];
  if (score >= 55) return ['🥈', 'Slibný projektový manažer', 'Projekt dopadl slušně. Zkus si ještě jednou projít, co tomuto typu projektu sedí.'];
  if (score >= 40) return ['🥉', 'Začínající PM', 'Projekt doběhl do cíle, ale se šrámy. Zkus hru znovu – události budou jiné.'];
  return ['🔥', 'Projekt v krizi', 'Tohle se nepovedlo. Přečti si poučení a zkus to znovu!'];
}

function end() {
  const f = finalScore();
  // Rekord se porovná jen jednou, aby překreslení (např. slovníček) nezměnilo „nový rekord“.
  if (S.prevRecord === null) {
    S.prevRecord = getRecord(S.sc.id);
    if (f.score > S.prevRecord) setRecord(S.sc.id, f.score);
  }
  const newRecord = f.score > S.prevRecord;
  const [icon, title, text] = grade(f.score);
  const mustDone = S.backlog.filter(b => b.moscow === 'M' && b.done).length;
  const mustAll = S.backlog.filter(b => b.moscow === 'M').length;
  const valueNote = isPhased() ? `přesah etap ${days(S.overrunTotal)} · rezerva ${days(S.buffer)}`
    : AP() === 'agile' ? `💎 ${f.value} skutečné hodnoty` : `💎 ${f.value} · Must ${mustDone}/${mustAll}`;
  const lessons = S.lessons.map(l => `
    <li class="lesson-row ${l.rating}">
      <div><b>${RATING_LABEL[l.rating].split(' ')[0]} ${l.title}</b> <small>— ${l.choice}</small></div>
      <div class="lesson-text">💡 ${l.lesson}</div>
    </li>`).join('');
  const found = S.found.map(x => PATTERNS.find(p => p.id === x.id));
  const atlas = getAtlas();
  const foundPos = found.filter(p => p.type === 'pattern').length;
  return `
    <div class="card hero end">
      ${S.failed ? `<div class="failed">⛔ ${S.failed}</div>` : ''}
      <div class="hero-emoji">${icon}</div>
      <h1>${title}</h1>
      <div class="score">${f.score}<small>/100 bodů</small></div>
      <p class="record">${newRecord ? '🎉 Nový osobní rekord v tomto projektu!' : `🏅 Tvůj rekord v tomto projektu: ${S.prevRecord} bodů`}</p>
      <p class="lead">${text}</p>
      <div class="score-grid">
        <div><span>Zdraví projektu</span><b>${Math.round(f.avgMetrics)}%</b><small>${stakeMin() === null ? 'průměr 5 ukazatelů' : 'ukazatele a stakeholdeři'}</small></div>
        <div><span>${isPhased() ? 'Dodání v termínu' : 'Dodaná hodnota'}</span><b>${Math.round(f.valuePct)}%</b><small>${valueNote}</small></div>
        <div><span>Manažerský úsudek</span><b>${Math.round(f.insightPct)}%</b><small>přístup, mix praktik a rozhodnutí</small></div>
        ${f.sustain !== null ? `<div><span>Rok poté</span><b>${f.sustain}%</b><small>udržitelnost výsledku</small></div>` : ''}
      </div>
    </div>
    ${insaneReveal()}
    ${S.aftermath.length ? `
      <div class="card aftermath">
        <h3>⏳ Dozvuky po projektu</h3>
        ${S.aftermath.map(a => `<p><b>${a.title}</b> – ${a.text} <small>(rozhodnutí „${a.fromChoice}“)</small></p><div class="chips">${deltaChips(a.deltas)}</div>`).join('')}
      </div>` : ''}
    <div class="card">
      <h3>🗺️ Vzorce, které tvůj projekt vytvořil</h3>
      <p>${approachChip()} Tvůj mix: ${chosenPractices().map(p => `<span class="ctx">${p.icon} ${p.name}</span>`).join(' ') || '–'}</p>
      ${found.length ? `
        <p class="hint">${foundPos} vzorců, ${found.length - foundPos} antivzorců. Každý je zapsaný jako řetězec kontext → forma → mechanismus → důsledek.</p>
        <div class="pattern-grid">${found.map(p => patternCard(p)).join('')}</div>` : '<p class="hint">V tomto projektu se žádný vzorec neprojevil.</p>'}
      <div class="actions"><button class="btn" data-action="atlas">🗺️ Celý atlas: ${atlas.length} / ${PATTERNS.length} objeveno</button></div>
    </div>
    <div class="card">
      <h3>Co sis z projektu odnesl(a)</h3>
      <ul class="lessons">${lessons}</ul>
    </div>
    <div class="actions">
      <button class="btn primary big" data-action="replay">Hrát znovu 🔄</button>
      <button class="btn" data-action="restart">Jiný projekt 🧭</button>
    </div>
  `;
}

function modal(title, body) {
  return `
    <div class="modal-back" data-action="closeModal">
      <div class="modal card" role="dialog" aria-label="${title}">
        <div class="modal-head"><h2>${title}</h2><button class="btn ghost" data-action="closeModal">✕</button></div>
        ${body}
      </div>
    </div>`;
}

function glossaryModal() {
  return modal('📖 Slovníček řízení projektů', `<dl>${GLOSSARY.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>`);
}

function atlasModal() {
  const atlas = getAtlas();
  const section = type => PATTERNS.filter(p => p.type === type).map(p => atlas.includes(p.id)
    ? patternCard(p)
    : `<div class="pattern locked ${type}"><span class="pattern-icon">🔒</span> <b>Neobjevený ${type === 'pattern' ? 'vzorec' : 'antivzorec'}</b></div>`).join('');
  return modal(`🗺️ Atlas vzorců (${atlas.length} / ${PATTERNS.length})`, `
    <p class="hint">Vzorce a antivzorce řízení projektů, které jsi odhalil(a) ve svých hrách. Každý popisuje, <b>v jakém kontextu</b> a <b>jakou formou</b> se projekt řídil, <b>jakým mechanismem</b> to působilo a <b>jaký to mělo důsledek</b>. Neobjevené odhalíš jinými projekty a mixy praktik.</p>
    <h3>🟢 Vzorce – mechanismy, které vytvářejí hodnotu</h3>
    <div class="pattern-grid">${section('pattern')}</div>
    <h3>🔴 Antivzorce – mechanismy, které vedou k dysfunkcím</h3>
    <div class="pattern-grid">${section('anti')}</div>`);
}

newGame();
