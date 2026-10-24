// Herní logika: stav hry, vyhodnocování rozhodnutí a vykreslování obrazovek.
'use strict';

const SPRINTS = 6;
const BASE_CAPACITY = 9;
const START_METRIC = 50;
// Rozpočet řídicí režie pro mix praktik; každý bod navíc stojí 1 SP kapacity za sprint.
const OVERHEAD_BUDGET = 8;
const MILESTONE_THRESHOLD = 45;
const MIX_INSIGHT_MAX = 80;
// Každá hra vylosuje nejvýš tolik obecných událostí, zbytek do SPRINTS doplní události scénáře.
const GENERIC_EVENTS_PER_GAME = 3;
// S praktikou Hypotézy a experimenty lze za sprint levně ověřit hodnotu tolika položek.
const EXPERIMENTS_PER_SPRINT = 2;
const RATING_POINTS = { best: 10, ok: 4, bad: 0 };
const RATING_LABEL = { best: '✅ Výborná volba', ok: '⚠️ Přijatelná volba', bad: '❌ Špatná volba' };
const TRACK_LABEL = { pred: '📐 prediktivní část', agile: '🔄 agilní část', both: '🔗 rozhraní obou částí' };
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
  hybrid: [['📐 Prediktivní část', 'milníky'], ['🔄 Agilní část', 'sprinty']],
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

function startScenario(id) {
  const sc = SCENARIOS.find(s => s.id === id);
  const generic = shuffle(GENERIC_EVENTS.filter(e => appliesTo(e, sc.approach)));
  const nGeneric = Math.min(GENERIC_EVENTS_PER_GAME, generic.length);
  const events = shuffle([
    ...shuffle(sc.events).slice(0, (sc.phases ? sc.phases.length : SPRINTS) - nGeneric),
    ...generic.slice(0, nGeneric),
  ]).map(e => prepDecision(e, sc.terms));
  S = {
    screen: 'brief',
    sc,
    targetValue: sc.targetValue ?? (sum((sc.backlog || []).filter(b => b.moscow === 'M' || b.moscow === 'S'), b => b.value) || 1),
    metrics: Object.fromEntries(METRICS.map(m => [m.id, START_METRIC])),
    insight: 0,
    insightMax: 0,
    lessons: [],
    sortOrder: shuffle(sc.workstreams),
    sortAnswers: {},
    sortResult: null,
    mix: [],
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
    capacityMod: 0,
    events,
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
}

// ---------- Typ projektu ----------

const AP = () => S.sc.approach;
const per = () => PERIODS[APPROACHES[AP()].period];

// ---------- Praktiky a vzorce ----------

const has = id => S.mix.includes(id);
const chosenPractices = () => S.mix.map(practiceById);
const currentMixCost = () => sum(chosenPractices(), p => p.cost);
const activePairs = () => PRACTICE_PAIRS.filter(x => has(x.a) && has(x.b));
const isTrap = p => (p.trapIn || []).includes(AP());
const isMisfit = p => !isTrap(p) && p.useIn && !p.useIn.includes(AP());
const hasPlanning = () => chosenPractices().some(p => p.planning);

function patternCtx() {
  return { has, approach: AP(), cost: S.mixCost, budget: OVERHEAD_BUDGET, overloads: S.overloads };
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
  return sum(chosenPractices(), p => p.capacity || 0) - Math.max(0, S.mixCost - OVERHEAD_BUDGET);
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
  if (m.rozpocet <= 0) S.failed = 'Rozpočet je vyčerpaný. Sponzor projekt zastavil.';
  else if (m.spokojenost <= 0) S.failed = 'Řídicí výbor ztratil důvěru a odvolal tě z projektu.';
  else if (m.moralka <= 0) S.failed = 'Tým se rozpadl – většina lidí odešla.';
  else if (m.harmonogram <= 0) S.failed = 'Projekt se zpozdil natolik, že ho vedení zrušilo.';
  if (S.failed) S.screen = 'end';
  return !!S.failed;
}

const baseCapacity = () => S.sc.baseCapacity ?? BASE_CAPACITY;
const moraleCapacity = () => Math.floor((S.metrics.moralka - 50) / 10);

function capacity() {
  return Math.max(3, baseCapacity() + moraleCapacity() + practiceCapacity() + S.capacityMod);
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
  return sum(S.selected, id => S.backlog.find(b => b.id === id).sp);
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
  if (!sources.length) return null;
  return { labels: sources.map(x => x.label), deltas: applyEffects(addEffects(...sources.map(x => x.e))) };
}

function runSprint() {
  const cap = capacity();
  S.capacityMod = 0;
  const items = S.selected.map(id => S.backlog.find(b => b.id === id));
  const committed = sum(items, i => i.sp);
  const delivered = [];
  const unfinished = [];
  let used = 0;
  for (const it of items) {
    if (!unfinished.length && used + it.sp <= cap) {
      used += it.sp;
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
  const deltas = applyEffects(effects);

  // Dodané funkce mohou odhalit nové podněty od uživatelů.
  const discovered = addItems(delivered.flatMap(it => (it.reveals || []).map(id => (S.sc.discoveries || []).find(d => d.id === id)).filter(Boolean)));

  const ongoing = applyOngoing();

  S.review = {
    cap, committed, experiments: S.experiments, delivered, unfinished, value, notes, deltas,
    discovered, ongoing, milestone: null, reveals: [],
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
  } else if (ms.kind === 'traction') {
    ok = S.valueDelivered >= ms.target;
    text = `${ok ? ms.okText : ms.lateText} (Skutečná hodnota pro uživatele: ${S.valueDelivered}, cíl ${ms.target}.)`;
    if (!ok) effects = { spokojenost: ms.afterSprint === SPRINTS ? -10 : -6 };
  } else {
    const threshold = milestoneThreshold();
    ok = S.metrics.harmonogram >= threshold;
    text = ok ? ms.okText : `${ms.lateText} (Harmonogram ${S.metrics.harmonogram}, potřeba ≥ ${threshold}.)`;
    if (!ok && ms.kind === 'dependency') { S.depUnlock = 4; effects = { spokojenost: -6 }; }
    if (!ok && ms.kind === 'schedule') effects = { spokojenost: -8, rozpocet: -5 };
  }
  const deltas = applyEffects(effects);
  S.milestones[ms.id] = ok ? 'ok' : 'late';
  return { ...ms, ok, text, deltas };
}

const MIX_LESSON = {
  hybrid: 'Dobrý hybridní mix pokryje plán a rizika prediktivní části, iterace a Product Ownera agilní části a hlavně jejich propojení – bez zbytečné režie.',
  pred: 'V prediktivním projektu se vyplatí detailní plán s kritickou cestou, řízení změn a rizik a přesné měření stavu. Agilní ceremonie by tu byly jen režií.',
  agile: 'V agilním projektu se vyplatí iterace, Product Owner, ověřování hypotéz a průběžné zlepšování. Detailní plán by stál na neověřených předpokladech.',
};

// Vyhodnotí mix praktik: jednorázové efekty, soulad s kontextem a manažerský úsudek.
function evaluateMix() {
  S.mixCost = currentMixCost();
  const chosen = chosenPractices();
  const fits = chosen.flatMap(p => (p.fits || []).filter(t => S.sc.context.includes(t)).map(t => ({ p, t })));
  const deltas = applyEffects(addEffects(...chosen.map(p => p.effects), ...fits.map(() => CONTEXT_FIT_EFFECTS)));
  const essentials = ESSENTIALS[AP()].map(e => ({ ...e, ok: e.any.some(has) }));
  const traps = chosen.filter(isTrap);
  const misfits = chosen.filter(isMisfit);
  const costOk = S.mixCost >= 4 && S.mixCost <= OVERHEAD_BUDGET + 1;
  if (AP() === 'pred') S.buffer = S.initialBuffer = (S.sc.buffer || 0) + sum(chosen, p => p.bufferBonus || 0);

  // Mix je klíčové rozhodnutí hry, proto váží víc než jednotlivá událost.
  const perEssential = Math.floor((MIX_INSIGHT_MAX - 8) / essentials.length);
  let points = perEssential * essentials.filter(e => e.ok).length + (traps.length || misfits.length ? 0 : 8)
    - 15 * traps.length - 8 * misfits.length - (costOk ? 0 : 15);
  points = Math.max(0, Math.min(MIX_INSIGHT_MAX, points));
  S.insight += points;
  S.insightMax += MIX_INSIGHT_MAX;
  S.lessons.push({
    title: 'Mix praktik',
    rating: points >= 64 ? 'best' : points >= 40 ? 'ok' : 'bad',
    choice: chosen.map(p => p.icon).join(' ') || 'žádné praktiky',
    lesson: MIX_LESSON[AP()],
  });
  S.mixResult = { deltas, fits, essentials, traps, misfits, pairs: activePairs() };
}

// ---------- Prediktivní projekt: etapy, Gantt a plánování po vlnách ----------

const isPhased = () => !!S.sc.phases;
const periods = () => (S.sc.phases ? S.sc.phases.length : SPRINTS);
const gateAfter = () => S.sc.gateAfter ?? 4;
const phase = () => S.sc.phases[S.sprint - 1];
const taskMD = t => t.days * t.people;
const phaseMD = ph => sum(ph.tasks, taskMD);
const taskEnd = (start, t) => start + t.days - 1;
const byTaskId = tasks => Object.fromEntries(tasks.map(t => [t.id, t]));
const GANTT_EXTRA_DAYS = 5;
const GANTT_LESSON = 'Dobrý Gantt má správné závislosti, respektuje kapacitu lidí a vejde se do délky etapy – ideálně s malou vůlí na neočekávané.';

function initGantt() {
  const tasks = phase().tasks;
  S.gantt = {
    starts: Object.fromEntries(tasks.map(t => [t.id, 1])),
    deps: Object.fromEntries(tasks.map(t => [t.id, []])),
  };
  S.phaseDelay = 0;
}

// Lidé v týmu na den: základ etapy upravený morálkou, mixem praktik a událostmi.
function crewSize() {
  const base = phase().crew;
  return Math.max(base - 2, base + Math.trunc((practiceCapacity() + moraleCapacity() + S.capacityMod) / 2));
}

// Kolik lidí je potřeba v jednotlivých dnech; extra = dny navíc u úkolu (opravy).
function usage(tasks, startOf, extra = {}) {
  const out = [];
  for (const t of tasks) {
    const s = startOf(t);
    for (let d = s; d < s + t.days + (extra[t.id] || 0); d++) out[d] = (out[d] || 0) + t.people;
  }
  return out;
}

// Úkoly, které začínají dřív, než skončí některý jejich předchůdce.
function depConflicts(tasks, starts, depsOf) {
  const byId = byTaskId(tasks);
  return tasks.filter(t => depsOf(t).some(d => starts[t.id] <= taskEnd(starts[d], byId[d])));
}

// Nejdřívější začátky podle vyznačených závislostí (dopředný průchod, bez ohledu na kapacitu).
function earliestStarts(tasks, deps) {
  const byId = byTaskId(tasks);
  const es = Object.fromEntries(tasks.map(t => [t.id, 1]));
  for (let i = 0; i <= tasks.length; i++) {
    for (const t of tasks) es[t.id] = Math.max(1, ...deps[t.id].map(d => es[d] + byId[d].days));
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
  const tasks = phase().tasks;
  const g = S.gantt;
  const crew = crewSize();
  const use = usage(tasks, t => g.starts[t.id]);
  return {
    crew,
    finish: Math.max(...tasks.map(t => taskEnd(g.starts[t.id], t))),
    declaredConflicts: depConflicts(tasks, g.starts, t => g.deps[t.id]),
    trueConflicts: depConflicts(tasks, g.starts, t => t.deps),
    missed: tasks.flatMap(t => t.deps.filter(d => !g.deps[t.id].includes(d)).map(d => [d, t.id])),
    extra: tasks.flatMap(t => g.deps[t.id].filter(d => !t.deps.includes(d)).map(d => [d, t.id])),
    overDays: use.filter(u => u > crew).length,
  };
}

// Přehraje etapu den po dni podle skutečných závislostí a skutečné velikosti týmu:
// úkol začne nejdřív v plánovaný den, až skončí jeho předchůdci a jsou volní lidé.
// Konflikt se skutečnou závislostí v plánu = přerušení a den práce navíc. Události přidají zpoždění.
function simulatePhase() {
  const tasks = phase().tasks;
  const run = S.phaseRun;
  const crew = run.plan.crew;
  const conflictIds = new Set(run.plan.trueConflicts.map(t => t.id));
  const actual = {};
  const use = [];
  const pending = tasks.slice().sort((a, b) => run.starts[a.id] - run.starts[b.id] || a.id.localeCompare(b.id));
  for (let day = 1; pending.length && day < 200; day++) {
    for (const t of pending.slice()) {
      if (day < run.starts[t.id] || !t.deps.every(d => actual[d] && actual[d].end < day)) continue;
      const len = t.days + (conflictIds.has(t.id) ? 1 : 0);
      if (Array.from({ length: len }, (_, i) => (use[day + i] || 0) + t.people > crew).some(Boolean)) continue;
      for (let i = 0; i < len; i++) use[day + i] = (use[day + i] || 0) + t.people;
      const predReady = Math.max(1, ...t.deps.map(d => actual[d].end + 1));
      actual[t.id] = {
        start: day, end: day + len - 1, rework: len > t.days,
        waitedForPeople: day > Math.max(run.starts[t.id], predReady) ? day - Math.max(run.starts[t.id], predReady) : 0,
      };
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
  const sim = simulatePhase();
  const overrun = Math.max(0, sim.finish - ph.days);
  const before = S.buffer;
  S.buffer -= overrun;
  S.overrunTotal += overrun;
  const beyond = Math.max(0, -S.buffer) - Math.max(0, -before);
  const deltas = applyEffects(addEffects(
    overrun ? { spokojenost: -3 * overrun } : { spokojenost: 4, harmonogram: 2 },
    beyond ? { harmonogram: -5 * beyond, rozpocet: -4 * beyond } : {},
    sim.rework.length ? { rozpocet: -sim.rework.length, moralka: -sim.rework.length } : {},
    sim.overDays ? { moralka: -Math.min(8, 2 * sim.overDays) } : {},
  ));
  S.milestones[ph.id] = overrun ? 'late' : 'ok';
  S.phaseResults[S.sprint - 1] = { finish: sim.finish, overrun };
  S.review = {
    phase: ph, sim, plan: S.phaseRun.plan, starts: S.phaseRun.starts, deps: S.phaseRun.deps,
    overrun, beyond, buffer: S.buffer, deltas,
    plannedMD: phaseMD(ph), actualMD: phaseMD(ph) + sum(sim.rework, t => t.people),
    ongoing: applyOngoing(), reveals: [],
  };
}

// ---------- Akce ----------

const ACTIONS = {
  pickScenario({ id }) { startScenario(id); },

  start() { S.screen = 'sort'; },

  sortPick({ id, val }) { if (!S.sortResult) S.sortAnswers[id] = val; },

  sortEval() {
    let correct = 0;
    for (const w of S.sc.workstreams) {
      S.insightMax += 5;
      if (S.sortAnswers[w.id] === w.answer) { correct++; S.insight += 5; }
    }
    const total = S.sc.workstreams.length;
    const wrong = total - correct;
    const deltas = applyEffects({ kvalita: -3 * wrong, harmonogram: -2 * wrong });
    S.sortResult = { correct, wrong, deltas };
    S.lessons.push({
      title: 'Rozdělení práce',
      rating: wrong === 0 ? 'best' : wrong <= 2 ? 'ok' : 'bad',
      choice: `${correct} z ${total} oblastí správně · ${APPROACHES[AP()].label}`,
      lesson: 'Jasné a stabilní požadavky → prediktivně. Nejistota a potřeba zpětné vazby → agilně. Hybrid jen tam, kde projekt obsahuje obojí.',
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

  experiment({ id }) {
    const it = S.backlog.find(b => b.id === id);
    if (!has('lean') || !it || valueKnown(it) || S.experiments >= EXPERIMENTS_PER_SPRINT) return;
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
    const es = earliestStarts(ph.tasks, S.gantt.deps);
    for (const t of ph.tasks) S.gantt.starts[t.id] = Math.min(es[t.id], ph.days + GANTT_EXTRA_DAYS - t.days + 1);
  },

  startPhase() {
    const ev = evaluateGantt();
    const ph = phase();
    const rating = !ev.trueConflicts.length && !ev.overDays && !ev.missed.length && ev.finish <= ph.days ? 'best'
      : ev.trueConflicts.length <= 1 && ev.overDays <= 1 && ev.finish <= ph.days + 1 ? 'ok' : 'bad';
    recordDecision(`Gantt etapy ${S.sprint}: ${ph.name}`,
      { rating, text: `plán do dne ${ev.finish} z ${ph.days}, konflikty ${ev.trueConflicts.length}, přetížení ${days(ev.overDays)}` }, GANTT_LESSON);
    S.phaseRun = { plan: ev, starts: { ...S.gantt.starts }, deps: JSON.parse(JSON.stringify(S.gantt.deps)) };
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
    const reveals = [
      ...(soft.by.some(p => p.id === 'risk') ? revealPatterns('soften') : []),
      ...(S.current.isGate ? revealPatterns('gate') : []),
    ];
    S.current.result = { i: +i, deltas, softenedBy: soft.by, added, delay, reveals };
  },

  eventNext() {
    if (checkFail()) return;
    if (S.current.isGate) {
      S.gateDone = true;
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
    if (S.sprint >= periods()) { S.screen = 'end'; return; }
    if (S.sprint === gateAfter() && !S.gateDone) {
      S.current = { event: S.gate, result: null, isGate: true };
      S.screen = 'event';
      return;
    }
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
  const screens = { intro, brief, sort, toolbox, kickoff, end, event,
    plan: () => (isPhased() ? ganttPlan() : plan()),
    review: () => (isPhased() ? phaseReview() : review()) };
  const showHud = !['intro', 'brief', 'end'].includes(S.screen);
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

function hud() {
  return `
    <section class="hud" aria-label="Stav projektu">
      ${METRICS.map(m => `
        <div class="meter ${meterClass(S.metrics[m.id])}" title="${m.label}: ${S.metrics[m.id]} / 100">
          <div class="meter-head"><span>${m.icon} ${m.label}</span><b>${S.metrics[m.id]}</b></div>
          <div class="bar"><i style="width:${S.metrics[m.id]}%"></i></div>
        </div>`).join('')}
    </section>`;
}

function deltaChips(deltas) {
  const entries = Object.entries(deltas || {}).filter(([, v]) => v !== 0);
  if (!entries.length) return '<span class="chip neutral">beze změny metrik</span>';
  return entries.map(([k, v]) => {
    const m = metricById(k);
    return `<span class="chip ${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v} ${m.icon} ${m.label}</span>`;
  }).join('');
}

function contextChips() {
  return S.sc.context.map(t => `<span class="ctx">${CONTEXT_TAGS[t].icon} ${CONTEXT_TAGS[t].label}</span>`).join('');
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
  if (!reveals || !reveals.length) return '';
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
  for (let s = 1; s <= SPRINTS; s++) {
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
  const cards = SCENARIOS.map(sc => {
    const rec = getRecord(sc.id);
    return `
      <button class="scenario card" data-action="pickScenario" data-id="${sc.id}">
        <span class="sc-icon">${sc.icon}</span>
        <b>${sc.name}</b>
        <span class="sc-tag">${sc.tagline}</span>
        <span class="sc-rec">${rec ? `🏅 Tvůj rekord: ${rec} bodů` : 'Zatím nehráno'}</span>
      </button>`;
  }).join('');
  return `
    <div class="hero card">
      <img class="hero-art" src="img/alchymie.svg" alt="Projektový manažer jako alchymista vaří v kotli projektovou metodiku" width="600" height="420">
      <h1>Projektová alchymie</h1>
      <p class="tagline">Namíchej správné řízení pro každý projekt</p>
      <p class="lead">Staneš se projektovým manažerem. Některé projekty se dají naplánovat dopředu, jiné se musí objevovat za pochodu a některé kombinují obojí.</p>
      <p>Univerzální recept neexistuje. Prvním úkolem je <b>poznat, jaký přístup projektu sedí</b> – prediktivní, agilní, nebo hybridní – a pak k němu namíchat správné praktiky.</p>
      <h3>Co tě čeká</h3>
      <ol class="steps">
        <li><b>Rozděl práci</b> – co řídit prediktivně a co agilně? A je to vůbec hybrid?</li>
        <li><b>Slož mix praktik</b> – karty se synergiemi, konflikty a omezenou režií.</li>
        <li><b>Řiď projekt</b> – sprint po sprintu, nebo etapu po etapě: plánuj práci, řeš krize, hlídej milníky.</li>
        <li><b>Odhal vzorce a antivzorce</b> – co tvůj mix v projektu doopravdy způsobil.</li>
      </ol>
      <p class="hint">Každá hra vylosuje jiné události a odpovědi jsou pokaždé v jiném pořadí.</p>
      <button class="btn" data-action="atlas">🗺️ Atlas vzorců: ${atlas.length} / ${PATTERNS.length} objeveno</button>
    </div>
    <h2 class="pick-title">Vyber si projekt</h2>
    <div class="scenario-grid">${cards}</div>`;
}

function brief() {
  const sc = S.sc;
  return `
    <div class="hero card">
      <div class="hero-emoji">${sc.icon}</div>
      <h1>${sc.name}</h1>
      <p class="lead">${sc.intro}</p>
      <p><b>Co projekt zahrnuje:</b> ${sc.scope}</p>
      <p><b>Kontext projektu:</b></p>
      <div class="ctx-row">${contextChips()}</div>
      <p class="hint">Jak projekt řídit, je na tobě – přijdeš na to v první fázi. Sleduj pět ukazatelů projektu; když některý spadne na nulu, projekt končí.</p>
      <div class="actions">
        <button class="btn primary big" data-action="start">Převzít projekt ▶</button>
        <button class="btn ghost" data-action="restart">← Jiný projekt</button>
      </div>
    </div>`;
}

function approachReveal() {
  const sc = S.sc;
  const a = APPROACHES[AP()];
  const body = AP() === 'hybrid' ? `
      <p>Projekt má dvě velmi odlišné tváře, a proto potřebuje <b>hybridní řízení</b>:</p>
      <div class="two-col">
        <div class="mini pred"><h3>📐 Prediktivní svět</h3><p>${sc.predWorld}</p></div>
        <div class="mini agile"><h3>🔄 Agilní svět</h3><p>${sc.agileWorld}</p></div>
      </div>` : `<p>${sc.approachText}</p>`;
  return `<div class="approach-reveal ${AP()}"><h3>${a.icon} Tohle je ${a.label.toLowerCase()}</h3>${body}</div>`;
}

function sort() {
  const r = S.sortResult;
  const ws = S.sc.workstreams;
  const allDone = ws.every(w => S.sortAnswers[w.id]);
  const cards = S.sortOrder.map(w => {
    const a = S.sortAnswers[w.id];
    const verdict = r ? (a === w.answer ? 'correct' : 'wrong') : '';
    return `
      <div class="ws card ${verdict}">
        <div class="ws-head"><span class="ws-icon">${w.icon}</span><b>${w.name}</b></div>
        <div class="ws-btns">
          <button class="btn toggle ${a === 'pred' ? 'on pred' : ''}" data-action="sortPick" data-id="${w.id}" data-val="pred" ${r ? 'disabled' : ''}>📐 Prediktivně</button>
          <button class="btn toggle ${a === 'agile' ? 'on agile' : ''}" data-action="sortPick" data-id="${w.id}" data-val="agile" ${r ? 'disabled' : ''}>🔄 Agilně</button>
        </div>
        ${r ? `<p class="why">${verdict === 'correct' ? '✅' : '❌ Správně: ' + (w.answer === 'pred' ? 'prediktivně' : 'agilně') + '.'} ${w.why}</p>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="phase-title"><span class="phase">Fáze 1 / 3</span><h2>Rozděl práci</h2>
      <p>U každé oblasti projektu rozhodni, zda ji řídit <b>prediktivně</b> (plán předem, vodopád) nebo <b>agilně</b> (iterace, zpětná vazba).</p>
      <p class="hint">Tip: Jak jasné jsou požadavky? Jak drahá je změna v průběhu? Dá se výsledek dodávat po kouscích? Projekt nemusí být hybridní.</p>
    </div>
    <div class="ws-grid">${cards}</div>
    ${r ? `
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
  const fit = (p.fits || []).some(t => S.sc.context.includes(t));
  const pairs = PRACTICE_PAIRS.filter(x => on && (x.a === p.id ? has(x.b) : x.b === p.id && has(x.a)));
  const revealed = !!S.mixResult;
  const trap = revealed && on && isTrap(p);
  const misfit = revealed && on && isMisfit(p);
  return `
    <button class="practice ${on ? 'on' : ''} ${trap ? 'trap' : ''} ${misfit ? 'misfit' : ''}" data-action="togglePractice" data-id="${p.id}" ${revealed ? 'disabled' : ''}>
      <span class="pp-head"><span class="pp-icon">${p.icon}</span><b>${p.name}</b>
        <span class="cost" title="Režie řízení">${p.cost ? '●'.repeat(p.cost) : 'zdarma'}</span></span>
      <span class="pp-desc">${p.desc}</span>
      <span class="pp-mech">⚙️ ${p.mech}</span>
      ${fit ? '<span class="pp-fit">🎯 sedí na kontext projektu</span>' : ''}
      ${pairs.map(x => `<span class="pp-pair ${x.type}">${x.type === 'syn' ? '✨' : '⚡'} s ${practiceById(x.a === p.id ? x.b : x.a).icon}</span>`).join('')}
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
  const over = cost - OVERHEAD_BUDGET;
  const columns = Object.keys(WORLD_LABEL).map(w => `
    <div class="pcol"><h3>${WORLD_LABEL[w]}</h3>
      ${PRACTICES.filter(p => p.world === w).map(practiceCard).join('')}
    </div>`).join('');
  const summary = r ? `
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
        <b class="${over > 0 ? 'over' : ''}">${cost} / ${OVERHEAD_BUDGET}</b>
        <div class="bar cap ${over > 0 ? 'over' : ''}"><i style="width:${Math.min(100, cost / OVERHEAD_BUDGET * 100)}%"></i></div>
        ${over > 0 ? `<small class="warn">kapacita týmu −${over} každé období</small>` : '<small>Každý bod nad rozpočet sníží kapacitu týmu.</small>'}
      </div>
      <div class="mix-pairs">${pairList(activePairs())}</div>
      <button class="btn primary big" data-action="confirmMix" ${S.mix.length ? '' : 'disabled'}>Potvrdit mix ▶</button>
    </div>`;
  return `
    <div class="phase-title"><span class="phase">Fáze 2 / 3</span><h2>Slož mix praktik</h2>
      <p>Vyber praktiky, kterými budeš projekt řídit. Každá stojí <b>režii řízení</b> (porady, reporty, schvalování) – rozpočet je ${OVERHEAD_BUDGET} bodů. Hledej kombinace, které se doplňují a sedí na tento typ projektu.</p>
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
    if (result) cls = i === result.i ? `picked ${c.rating}` : 'dim';
    return `<button class="choice ${cls}" data-action="${pickAction}" data-i="${i}" ${result || locked ? 'disabled' : ''}>
      <span class="choice-letter">${'ABCD'[i]}</span><span>${c.text}
      ${locked ? `<small class="lock-note">🔒 Vyžaduje praktiku: ${practiceById(c.needs).icon} ${practiceById(c.needs).name}</small>` : ''}</span></button>`;
  }).join('');
  let fb = '';
  if (result) {
    const c = item.choices[result.i];
    const best = item.choices.find(x => x.rating === 'best');
    fb = `
      <div class="feedback ${c.rating}">
        <div class="rating">${RATING_LABEL[c.rating]}</div>
        <p>${c.feedback}</p>
        <div class="chips">${deltaChips(result.deltas)}${c.capacityMod ? `<span class="chip down">${c.capacityMod} SP kapacita ${per().next}</span>` : ''}${c.dropScope ? `<span class="chip down">„${MOSCOW[c.dropScope].label}“ položky odstraněny</span>` : ''}${(result.added || []).map(a => `<span class="chip neutral">🆕 ${a.name}</span>`).join('')}${result.delay ? `<span class="chip down">⏱️ +${days(result.delay)} zpoždění etapy</span>` : ''}</div>
        ${result.softenedBy && result.softenedBy.length ? `<p class="softened">🛡️ Dopad zmírnila praktika: ${result.softenedBy.map(p => `${p.icon} ${p.name}`).join(', ')}</p>` : ''}
        ${c.rating !== 'best' ? `<p class="best-was">Nejlepší volba: <b>${best.text}</b>${best.needs && !has(best.needs) ? ' – ale tvůj mix praktik ji neumožnil.' : ''}</p>` : ''}
        <div class="lesson">💡 ${item.lesson}</div>
      </div>
      ${revealBlock(result.reveals)}`;
  }
  const showTrack = item.track && AP() === 'hybrid';
  return `
    <div class="card decision">
      <div class="decision-head"><span class="big-icon">${item.icon}</span><h3>${item.title}</h3>
        ${showTrack ? `<span class="tag ${item.track}">${TRACK_LABEL[item.track]}</span>` : ''}
      </div>
      <p class="situation">${item.text}</p>
      <div class="choices">${choices}</div>
      ${fb}
    </div>`;
}

function kickoffRules() {
  const t = S.sc.terms;
  if (AP() === 'pred') {
    const ph = S.sc.phases;
    return [
      `Projekt má ${ph.length} etapy různé délky (${ph.map(p => p.days).join(', ')} pracovních dní). Plánuje se <b>po vlnách</b>: budoucí etapy znáš jen nahrubo (délka, odhad práce v MD, milník), nejbližší etapu naplánuješ podrobně v <b>Ganttu</b>.`,
      'V Ganttu kliknutím nastavíš začátek každého úkolu a vyznačíš <b>závislosti</b> – po kterých úkolech smí začít. Hlídej, kolik lidí je který den potřeba: tým má omezenou velikost.',
      '<b>Skutečné závislosti</b> se ukážou až během etapy. Když úkol začne dřív, než skončí jeho předchůdce, práce se přeruší a den se dělá znovu. Přetížený tým etapu natáhne.',
      hasPlanning() ? 'Tvůj nástroj pro harmonogram umí úkoly jedním kliknutím <b>seřadit co nejdřív podle závislostí</b>.' : '⚠️ Bez praktiky pro harmonogram musíš všechno rozvrhnout ručně.',
      has('cpm') ? 'Analýza kritické cesty ukáže <b>kritické úkoly a vůli</b> ostatních.' : 'Bez analýzy kritické cesty nevidíš, které úkoly nesmí sklouznout.',
      `Co se nevejde do délky etapy, ukrojí z <b>rezervy projektu (${days(S.buffer)})</b>. Když dojde, každý další den stojí 📅 i 💰.`,
      'V každé etapě přijde <b>událost</b>; některé volby odemyká jen správná praktika. Po 2. etapě tě čeká <b>kontrolní den</b>.',
    ];
  }
  if (AP() === 'agile') {
    return [
      'Rozsah <b>není pevný</b>. Cílem je co nejvíc <b>skutečné hodnoty pro uživatele</b> – měří se trakce po 2., 4. a 6. sprintu.',
      'Na začátku sprintu vyber z backlogu položky do <b>kapacity týmu</b> (story pointy).',
      `Hodnota u položek je jen <b>odhad (hypotéza)</b> – skutečnost ukáže až dodání${has('lean') ? `, nebo ji <b>ověříš experimentem 🧪</b> (až ${EXPERIMENTS_PER_SPRINT} za sprint)` : ''}.`,
      'Dodané funkce mohou odhalit <b>nové podněty od uživatelů</b> – backlog se vyvíjí.',
      'Během každého sprintu přijde <b>událost</b>. V polovině projektu tě čeká <b>demo day</b> pro investory.',
    ];
  }
  return [
    `<b>Prediktivní část</b> (${t.predShort}) běží podle plánu. S tvým mixem se milníky splní, pokud udržíš <b>📅 Harmonogram ≥ ${milestoneThreshold()}</b>.`,
    '<b>Agilní část</b>: na začátku každého sprintu vyber z backlogu položky do <b>kapacity týmu</b> (story pointy). Kapacitu ovlivňuje morálka i tvůj mix praktik.',
    `Prioritizuj podle <b>MoSCoW</b>. Všechny <b>Must</b> položky musí být hotové do ${t.launch}.`,
    `Některé položky na sobě závisí – a ${S.sc.dependency.hint} Tady se oba světy potkávají!`,
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
        <li>Tvůj mix praktik působí celou dobu – a postupně odhalíš, jaké <b>vzorce a antivzorce</b> v projektu vytvořil.</li>
      </ul>
      <button class="btn primary" data-action="toPlan">Na plánování 1. ${per().gen} ▶</button>
    </div>`;
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
  const canExperiment = has('lean') && S.experiments < EXPERIMENTS_PER_SPRINT;
  const rows = items.map(it => {
    const lock = itemLock(it);
    const sel = S.selected.includes(it.id);
    const exp = has('lean') && !it.done && !valueKnown(it)
      ? `<button class="exp-btn" data-action="experiment" data-id="${it.id}" ${canExperiment ? '' : 'disabled'} title="Ověřit skutečnou hodnotu levným experimentem (landing page, rozhovory)">🧪 ověřit</button>` : '';
    return `
      <div class="bl-row">
        <button class="bl-item ${it.done ? 'done' : ''} ${lock && !it.done ? 'locked' : ''} ${sel ? 'sel' : ''}" data-action="toggle" data-id="${it.id}" ${lock ? 'disabled' : ''} title="${lock || MOSCOW[it.moscow].title}">
          <span class="check">${it.done ? '✔' : sel ? '☑' : lock ? '🔒' : '☐'}</span>
          ${itemBadge(it)}
          <span class="bl-name">${it.name}${lock && !it.done ? `<small>${lock}</small>` : ''}</span>
          <span class="sp">${it.sp} SP</span>
          <span class="val" title="Hodnota pro uživatele">${itemValueLabel(it)}</span>
        </button>${exp}
      </div>`;
  }).join('');
  const mustLeft = S.backlog.filter(b => b.moscow === 'M' && !b.done).length;
  const parts = [
    ['Základ', baseCapacity()],
    ['Morálka', moraleCapacity()],
    ['Mix praktik', practiceCapacity()],
    ['Události', S.capacityMod],
  ].filter(([, v], i) => i === 0 || v);
  const listTitle = 'Product backlog';
  const hint = AP() === 'agile'
      ? `Klikni na položky, které tým ve sprintu udělá. 💎 ~ je jen odhad hodnoty – skutečnost ukáže dodání${has('lean') ? ' nebo experiment 🧪' : ''}.`
      : 'Klikni na položky, které tým v tomto sprintu udělá. Pořadí kliknutí = priorita v rámci sprintu.';
  const goal = AP() === 'agile'
    ? (() => { const next = S.sc.milestones.find(m => m.afterSprint >= S.sprint); return `<li>Dodaná hodnota zatím <b>${S.valueDelivered}</b>${next ? `, další cíl: ${next.icon} ${next.name} – ${next.target}` : ''}.</li>`; })()
    : `<li>Zbývá dokončit <b>${mustLeft}</b> Must položek (${per().nom.toLowerCase()} ${S.sprint} z ${SPRINTS}).</li>`;
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
        ${has('lean') && AP() !== 'pred' ? `<p class="hint">🧪 Experimenty v tomto sprintu: ${S.experiments} / ${EXPERIMENTS_PER_SPRINT}</p>` : ''}
        <ul class="facts">
          <li>Kapacita: ${parts.map(([l, v], i) => `${l} ${i ? signed(v) : v}`).join(', ')}.</li>
          ${goal}
        </ul>
        <button class="btn primary big" data-action="startSprint" ${S.selected.length || !S.backlog.some(b => !itemLock(b)) ? '' : 'disabled'}>Spustit ${per().acc} ${S.sprint} ▶</button>
      </aside>
    </div>`;
}

function event() {
  const c = S.current;
  const gateTitle = AP() === 'agile' ? 'Investoři rozhodují' : AP() === 'pred' ? 'Kontrolní den' : 'Řídicí výbor zasedá';
  return `
    <div class="phase-title"><span class="phase">${c.isGate ? 'Kontrolní bod' : `${per().nom} ${S.sprint} z ${periods()} · probíhá`}</span>
      <h2>${c.isGate ? gateTitle : `Uprostřed ${per().gen} se něco stalo…`}</h2></div>
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
  const heading = { hybrid: 'Agilní část: co tým dodal', pred: 'Co se v etapě dokončilo', agile: 'Co tým dodal' }[AP()];
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
      <div class="chips">${deltaChips(r.deltas)}</div>
      ${r.ongoing ? `
        <h4>Průběžný vliv tvého mixu</h4>
        <p class="hint">${r.ongoing.labels.join(' · ')}</p>
        <div class="chips">${deltaChips(r.ongoing.deltas)}</div>` : ''}
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
    <div class="actions"><button class="btn primary" data-action="reviewNext">${last ? 'Vyhodnotit projekt 🏁' : S.sprint === gateAfter() && !S.gateDone ? gateLabel : `Na plánování ${per().gen} ${S.sprint + 1} ▶`}</button></div>
  `;
}

// ---------- Vykreslení: Gantt a etapy ----------

const roughMD = ph => `~${Math.round(phaseMD(ph) / 5) * 5} MD`;

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
    const detail = n < S.sprint && res ? `skutečně ${res.finish} z ${p.days} dní`
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

// Mřížka Ganttu. mode 'edit' = hráč plánuje, 'review' = plán vs. skutečnost.
function ganttGrid(tasks, gridDays, phaseDays, rowFn, footer) {
  const head = Array.from({ length: gridDays }, (_, i) => i + 1)
    .map(d => `<div class="g-day ${d > phaseDays ? 'out' : ''} ${d === phaseDays ? 'end' : ''}">${d}</div>`).join('');
  return `
    <div class="gantt-wrap">
      <div class="gantt" style="--days:${gridDays}">
        <div class="g-row g-head"><div class="g-task">Úkol</div><div class="g-deps">Začíná po</div><div class="g-days">${head}</div></div>
        ${tasks.map(rowFn).join('')}
        ${footer || ''}
      </div>
    </div>`;
}

function usageRow(use, gridDays, phaseDays, crew, label) {
  const cells = Array.from({ length: gridDays }, (_, i) => {
    const u = use[i + 1] || 0;
    return `<div class="g-use ${u > crew ? 'over' : ''} ${i + 1 > phaseDays ? 'out' : ''}">${u || ''}</div>`;
  }).join('');
  return `<div class="g-row g-foot"><div class="g-task"><b>${label}</b><small>tým ${crew} lidí/den</small></div><div class="g-deps"></div><div class="g-days">${cells}</div></div>`;
}

function ganttPlan() {
  const ph = phase();
  const tasks = ph.tasks;
  const g = S.gantt;
  const gridDays = ph.days + GANTT_EXTRA_DAYS;
  const ev = evaluateGantt();
  const conflictIds = new Set(ev.declaredConflicts.map(t => t.id));
  const cp = has('cpm') ? criticalInfo(tasks, g.deps) : null;
  const use = usage(tasks, t => g.starts[t.id]);
  const row = t => {
    const s = g.starts[t.id];
    const e = taskEnd(s, t);
    const cells = Array.from({ length: gridDays }, (_, i) => {
      const d = i + 1;
      const inBar = d >= s && d <= e;
      const cls = [inBar ? 'in' : '', inBar && conflictIds.has(t.id) ? 'conflict' : '', inBar && cp && cp.critical.has(t.id) ? 'crit' : '',
        d > ph.days ? 'out' : '', d === ph.days ? 'end' : ''].join(' ');
      return `<button class="g-cell ${cls}" data-action="ganttStart" data-task="${t.id}" data-day="${d}" title="${t.id}: začít dnem ${d}">${inBar && d === s ? t.id : ''}</button>`;
    }).join('');
    const chips = tasks.filter(o => o.id !== t.id).map(o => `
      <button class="dep ${g.deps[t.id].includes(o.id) ? 'on' : ''}" data-action="ganttDep" data-task="${t.id}" data-dep="${o.id}" title="${t.id} smí začít až po skončení ${o.id}">${o.id}</button>`).join('');
    const cpNote = cp ? (cp.critical.has(t.id) ? '<span class="crit-tag">⚑ kritická cesta</span>' : `<span class="float-tag">vůle ${days(cp.float[t.id])}</span>`) : '';
    return `
      <div class="g-row ${conflictIds.has(t.id) ? 'has-conflict' : ''}">
        <div class="g-task"><b class="g-id">${t.id}</b> ${t.name}
          <small>${days(t.days)} · ${t.people} 👷 · ${taskMD(t)} MD ${cpNote}</small>
          <small class="note">${t.note}</small></div>
        <div class="g-deps">${chips}</div>
        <div class="g-days">${cells}</div>
      </div>`;
  };
  const slack = ph.days - ev.finish;
  return `
    <div class="phase-title"><span class="phase">${per().nom} ${S.sprint} z ${periods()}</span><h2>Podrobný plán etapy: ${ph.name}</h2>
      <p>${ph.goal} Cíl etapy: ${ph.milestone.icon} <b>${ph.milestone.name}</b>.</p></div>
    ${phaseTimeline()}
    <div class="card">
      <div class="gantt-stats">
        <div><span>Délka etapy</span><b>${days(ph.days)}</b></div>
        <div class="${slack < 0 ? 'bad' : slack === 0 ? 'warn' : 'good'}"><span>Plán končí</span><b>dnem ${ev.finish}</b><small>${slack >= 0 ? `vůle ${days(slack)}` : `přesah ${days(-slack)}`}</small></div>
        <div><span>Práce</span><b>${phaseMD(ph)} MD</b><small>tým ${ev.crew} lidí/den</small></div>
        <div class="${ev.declaredConflicts.length ? 'bad' : 'good'}"><span>Konflikty závislostí</span><b>${ev.declaredConflicts.length}</b><small>podle tvých vazeb</small></div>
        <div class="${ev.overDays ? 'bad' : 'good'}"><span>Přetížení týmu</span><b>${days(ev.overDays)}</b></div>
        <div class="${S.buffer < 0 ? 'bad' : S.buffer === 0 ? 'warn' : ''}"><span>Rezerva projektu</span><b>${days(S.buffer)}</b></div>
      </div>
      <p class="hint">Klikni v řádku úkolu na den, kdy má začít. Ve sloupci <b>Začíná po</b> vyznač, po kterých úkolech smí začít. Dole vidíš, kolik lidí je který den potřeba. Skutečné závislosti se ukážou až během etapy – odvoď je z popisu práce.</p>
      ${ganttGrid(tasks, gridDays, ph.days, row, usageRow(use, gridDays, ph.days, ev.crew, 'Lidé na den'))}
      <div class="actions">
        ${hasPlanning() ? '<button class="btn" data-action="ganttAuto">⏩ Seřadit co nejdřív podle závislostí</button>' : '<span class="hint">S praktikou pro harmonogram by úkoly seřadil nástroj.</span>'}
        <button class="btn primary big" data-action="startPhase">Spustit etapu ${S.sprint} ▶</button>
      </div>
    </div>`;
}

function phaseReview() {
  const r = S.review;
  const ph = r.phase;
  const tasks = ph.tasks;
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
    return `
      <div class="g-row">
        <div class="g-task"><b class="g-id">${t.id}</b> ${t.name}<small>${a.rework ? '⚠️ přerušeno, den navíc' : a.waitedForPeople ? `👷 čekal na volné lidi (${days(a.waitedForPeople)})` : a.start > ps ? `čekal na předchůdce (${days(a.start - ps)})` : '✓ podle plánu'}</small></div>
        <div class="g-deps"><small>skutečně po: <b>${truth}</b></small></div>
        <div class="g-days">${cells}</div>
      </div>`;
  };
  const causes = [
    ...r.sim.rework.map(t => {
      const pred = t.deps.find(d => r.starts[t.id] <= taskEnd(r.starts[d], byId[d]));
      return `⚠️ <b>${t.id} ${t.name}</b> začal dřív, než skončil <b>${pred} ${byId[pred].name}</b> – práce se přerušila a den se dělal znovu.`;
    }),
    ...(r.plan.missed.length && !r.sim.rework.length ? [`Nevyznačil(a) jsi ${r.plan.missed.length} skutečnou závislost(i), ale plán je náhodou dodržel.`] : []),
    ...(r.plan.extra.length ? [`Zbytečné vazby: ${r.plan.extra.map(([d, t]) => `${t} po ${d}`).join(', ')} – úkoly mohly běžet souběžně.`] : []),
    ...(r.sim.waited.length ? [`👷 Plán počítal s víc lidmi, než tým má (${days(r.sim.overDays)} přetížení). Úkoly ${r.sim.waited.map(t => t.id).join(', ')} musely čekat, až se lidé uvolní.`] : []),
    ...(r.sim.delay ? [`📅 Událost přidala ${days(r.sim.delay)} zpoždění.`] : []),
  ];
  const evm = has('evm') ? `<p>📈 <b>EVM:</b> plánovaná práce ${r.plannedMD} MD, skutečná ${r.actualMD} MD · CPI ≈ ${(r.plannedMD / r.actualMD).toFixed(2)} · SPI ≈ ${(Math.min(ph.days, r.plan.finish) / r.sim.finish).toFixed(2)}</p>` : '';
  const last = S.sprint >= periods();
  return `
    <div class="phase-title"><span class="phase">${per().nom} ${S.sprint} z ${periods()} · konec</span><h2>Kontrola etapy: ${ph.name}</h2></div>
    ${phaseTimeline()}
    <div class="card">
      <div class="gantt-stats">
        <div><span>Plán</span><b>dnem ${r.plan.finish}</b></div>
        <div class="${r.overrun ? 'bad' : 'good'}"><span>Skutečnost</span><b>dnem ${r.sim.finish}</b><small>z ${days(ph.days)}</small></div>
        <div class="${r.buffer < 0 ? 'bad' : r.buffer === 0 ? 'warn' : ''}"><span>Rezerva projektu</span><b>${days(r.buffer)}</b>${r.overrun ? `<small>čerpáno ${days(r.overrun)}</small>` : ''}</div>
      </div>
      <p class="hint">Obrys = tvůj plán, plná barva = skutečnost. Teď vidíš i skutečné závislosti.</p>
      ${ganttGrid(tasks, gridDays, ph.days, row)}
      ${causes.length ? `<ul class="causes">${causes.map(c => `<li>${c}</li>`).join('')}</ul>` : '<p class="good-note">✅ Etapa proběhla přesně podle plánu.</p>'}
      ${evm}
      ${r.beyond ? `<p class="warn">Rezerva projektu je vyčerpaná – ${days(r.beyond)} navíc stojí harmonogram i peníze.</p>` : ''}
      <div class="chips">${deltaChips(r.deltas)}</div>
      ${r.ongoing ? `<h4>Průběžný vliv tvého mixu</h4><p class="hint">${r.ongoing.labels.join(' · ')}</p><div class="chips">${deltaChips(r.ongoing.deltas)}</div>` : ''}
    </div>
    <div class="card milestone ${r.overrun ? 'late' : 'ok'}">
      <h3>📐 Milník: ${ph.milestone.icon} ${ph.milestone.name} ${r.overrun ? '– se zpožděním' : '✓'}</h3>
      <p>${r.overrun ? `Etapa přetáhla o ${days(r.overrun)}${r.buffer >= 0 ? ', zatím to pokryla rezerva projektu.' : ' a rezerva projektu nestačila.'}` : 'Etapa skončila v plánované délce.'}</p>
    </div>
    ${revealBlock(r.reveals)}
    <div class="actions"><button class="btn primary" data-action="reviewNext">${last ? 'Vyhodnotit projekt 🏁' : S.sprint === gateAfter() && !S.gateDone ? 'Na kontrolní den 🔍' : `Na plánování ${per().gen} ${S.sprint + 1} ▶`}</button></div>
  `;
}

function finalScore() {
  const avgMetrics = sum(METRICS, m => S.metrics[m.id]) / METRICS.length;
  const value = sum(S.backlog.filter(b => b.done), itemValue);
  // Prediktivní projekt: hodnotí se dodání v termínu (čerpání rezervy mírně, přetažení výrazně).
  const valuePct = isPhased()
    ? Math.max(0, 100 - 5 * Math.min(S.overrunTotal, S.initialBuffer) - 15 * Math.max(0, -S.buffer))
    : Math.min(100, value / S.targetValue * 100);
  const insightPct = S.insightMax ? S.insight / S.insightMax * 100 : 0;
  const score = S.failed ? Math.min(35, avgMetrics * 0.35) : avgMetrics * 0.35 + valuePct * 0.3 + insightPct * 0.35;
  return { avgMetrics, value, valuePct, insightPct, score: Math.round(score) };
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
        <div><span>Zdraví projektu</span><b>${Math.round(f.avgMetrics)}%</b><small>průměr 5 ukazatelů</small></div>
        <div><span>${isPhased() ? 'Dodání v termínu' : 'Dodaná hodnota'}</span><b>${Math.round(f.valuePct)}%</b><small>${valueNote}</small></div>
        <div><span>Manažerský úsudek</span><b>${Math.round(f.insightPct)}%</b><small>přístup, mix praktik a rozhodnutí</small></div>
      </div>
    </div>
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
