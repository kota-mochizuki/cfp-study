import type { Card, ChoiceKey, QuestionMeta, SessionItem, SessionMode, Slot, SubjectId, TaxNode, Track } from '../domain/types';
import { SUBJECTS, SUBJECT_MAP, choiceLabel } from '../domain/subjects';
import { DAY, daysBetween, endOfDay, startOfDay } from '../lib/time';
import { shuffle } from '../lib/random';
import { WEAK_THRESHOLD, type NodeStat } from './mastery';

export interface BuildContext {
  /** 出題対象（active、旧制度は設定次第で除外済み） */
  metas: QuestionMeta[];
  cards: Map<string, Card>;
  stats: Map<string, NodeStat>;
  nodes: Map<string, TaxNode>;
  now: number;
  examDate: number | null;
  favorites?: Set<string>;
  /** 直近のSurprise利用率（0〜1）。UX学習による新規性の調整に使う */
  surpriseAffinity?: number;
  rand?: () => number;
}

export interface BuildOptions {
  mode: SessionMode;
  count: number;
  /** 課目・大分類などで範囲を絞る */
  scopeNodeId?: string;
  exploreShare?: number;
}

export interface Plan {
  items: SessionItem[];
  exploreShare: number;
  counts: Record<Slot, number>;
}

export const TIME_BUDGETS = [
  { min: 5, label: '5分' },
  { min: 10, label: '10分' },
  { min: 20, label: '20分' },
  { min: 40, label: 'しっかり' },
];

export function countForMinutes(min: number, secPerQuestion: number): number {
  return Math.max(3, Math.min(40, Math.round((min * 60) / secPerQuestion)));
}

const TRACK: Record<Slot, Track> = { CORE: 'MASTER', CHALLENGE: 'MASTER', DISCOVERY: 'EXPLORE', SURPRISE: 'EXPLORE' };

interface Cand {
  q: QuestionMeta;
  card?: Card;
  answered: boolean;
  today: boolean;
  due: boolean;
  weak: boolean;
  topicM: number | null;
}

export function descendantsOf(nodes: Map<string, TaxNode>, rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (!n.parentId) continue;
    const arr = children.get(n.parentId) ?? [];
    arr.push(n.id);
    children.set(n.parentId, arr);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!out.has(c)) { out.add(c); stack.push(c); }
  return out;
}

export function buildSession(ctx: BuildContext, opt: BuildOptions): Plan {
  const rand = ctx.rand ?? Math.random;
  const { now } = ctx;
  const today0 = startOfDay(now);
  const scope = opt.scopeNodeId ? descendantsOf(ctx.nodes, opt.scopeNodeId) : null;
  const all: Cand[] = ctx.metas
    .filter((q) => !scope || scope.has(q.topicId))
    .map((q) => {
      const card = ctx.cards.get(q.id);
      const answered = !!card && card.correctCount + card.wrongCount > 0;
      const topicM = ctx.stats.get(q.topicId)?.mastery ?? null;
      return {
        q, card, answered,
        today: answered && (card!.lastAnsweredAt ?? 0) >= today0,
        due: answered && card!.dueAt != null && card!.dueAt <= endOfDay(now),
        weak: answered && (card!.level === 1 || (topicM != null && topicM < WEAK_THRESHOLD)),
        topicM,
      };
    });

  const daysToExam = ctx.examDate ? Math.max(0, daysBetween(now, ctx.examDate)) : 999;
  const urgency = Math.max(0, Math.min(1, 1 - daysToExam / 365));
  const bias = subjectBias(all, now);
  const jitter = (k = 0.3) => rand() * k;
  const base = (c: Cand) => ((c.q.importance / 3) + 0.7 * (c.q.frequency / 3)) * (1 + urgency);
  const unlearnedTopic = (c: Cand) => ((ctx.stats.get(c.q.topicId)?.answered ?? 0) === 0 ? 1 : 0);
  const pen = (c: Cand) => 3 * Math.max(0, (bias.get(c.q.subject) ?? 0) - 1 / 6);

  const score: Record<Slot, (c: Cand) => number> = {
    CORE: (c) => {
      const overdue = c.due && c.card?.dueAt ? Math.min(14, Math.max(0, (now - c.card.dueAt) / DAY)) / 14 : 0;
      // 同じ誤答を繰り返している＝誤概念が残っている問題は優先
      return (c.due ? 1.5 + 2 * overdue : 0) + (c.card?.flagged ? 1 : 0) + (repeatedWrong(c.card) ? 1 : 0) + 2 * (1 - (c.topicM ?? 0.5)) + base(c) - pen(c) + jitter();
    },
    CHALLENGE: (c) => c.q.difficulty + (c.topicM ?? 0.5) + jitter(0.8),
    DISCOVERY: (c) => base(c) + 1.2 * unlearnedTopic(c) - pen(c) + jitter(0.6),
    SURPRISE: () => rand(),
  };

  const overallM = masteryOf(all);
  const challengeMin = Math.min(5, Math.max(3, Math.round(2 + 2 * overallM) + 1));

  const pools: Record<Slot, (c: Cand) => boolean> = {
    CORE: (c) => !c.today && (c.due || c.weak || !!c.card?.flagged),
    CHALLENGE: (c) => !c.today && !(c.answered && c.card!.lastResult === false) && c.q.difficulty >= challengeMin,
    DISCOVERY: (c) => !c.answered,
    SURPRISE: (c) => !c.today,
  };

  const n = Math.min(opt.count, all.length);
  let targets: Record<Slot, number>;
  let explore = 0;

  switch (opt.mode) {
    case 'weak':
      return finalize(pickOrdered(all.filter((c) => c.answered && (c.weak || c.card!.wrongCount > 0))
        .sort((a, b) => (a.topicM ?? 0) - (b.topicM ?? 0) || b.card!.wrongCount - a.card!.wrongCount), n, 'CORE', ctx),
        all, n, ctx, 'CORE', rand);
    case 'wrong':
      return finalize(pickOrdered(all.filter((c) => c.answered && c.card!.wrongCount > 0)
        .sort((a, b) => Number(a.card!.lastResult) - Number(b.card!.lastResult) || (b.card!.lastAnsweredAt ?? 0) - (a.card!.lastAnsweredAt ?? 0)), n, 'CORE', ctx), [], n, ctx, 'CORE', rand);
    case 'unanswered':
      return finalize(interleave(pickOrdered(all.filter((c) => !c.answered).sort((a, b) => score.DISCOVERY(b) - score.DISCOVERY(a)), n, 'DISCOVERY', ctx), rand), [], n, ctx, 'DISCOVERY', rand);
    case 'random':
    case 'mock':
      return finalize(opt.mode === 'mock' ? stratified(all, n, rand, ctx, 'SURPRISE') : pickOrdered(shuffle(all, rand), n, 'SURPRISE', ctx), [], n, ctx, 'SURPRISE', rand);
    case 'favorites':
      return finalize(pickOrdered(shuffle(all.filter((c) => ctx.favorites?.has(c.q.id)), rand), n, 'CORE', ctx), [], n, ctx, 'CORE', rand);
    case 'flagged':
      return finalize(pickOrdered(all.filter((c) => c.card?.flagged), n, 'CORE', ctx), [], n, ctx, 'CORE', rand);
    case 'challenge': {
      const pool = all.filter(pools.CHALLENGE).sort((a, b) => score.CHALLENGE(b) - score.CHALLENGE(a));
      const rest = all.filter((c) => !c.today).sort((a, b) => b.q.difficulty - a.q.difficulty || rand() - 0.5);
      return finalize(pickOrdered(pool, n, 'CHALLENGE', ctx), rest, n, ctx, 'CHALLENGE', rand);
    }
    case 'calc': {
      const calc = all.filter((c) => c.q.type === 'calculation');
      const ordered = [
        ...calc.filter((c) => c.due || c.weak).sort((a, b) => score.CORE(b) - score.CORE(a)),
        ...calc.filter((c) => !c.answered).sort((a, b) => score.DISCOVERY(b) - score.DISCOVERY(a)),
        ...shuffle(calc.filter((c) => c.answered && !c.due && !c.weak), rand),
      ];
      return finalize(pickOrdered(ordered, n, 'CORE', ctx), [], n, ctx, 'CORE', rand);
    }
    case 'boss': {
      const items = bossItems(ctx, n);
      return { items, exploreShare: 0, counts: countSlots(items) };
    }
    case 'diagnostic':
      return finalize(diagnostic(all, n, rand, ctx), [], n, ctx, 'DISCOVERY', rand);
    case 'surprise':
      // 中身は分からないが、裏側で復習・苦手・未学習の重要論点を混ぜる
      targets = { CORE: 1, DISCOVERY: 1, CHALLENGE: n >= 5 ? 1 : 0, SURPRISE: 0 };
      targets.SURPRISE = n - targets.CORE - targets.DISCOVERY - targets.CHALLENGE;
      break;
    default: {
      explore = opt.exploreShare ?? exploreShare(ctx, all, n, daysToExam);
      const exploreN = Math.round(n * explore);
      const masterN = n - exploreN;
      const challengeN = n >= 8 ? Math.round(masterN * 0.2) : 0;
      const surpriseN = exploreN >= 3 ? (n >= 15 ? 2 : 1) : 0;
      targets = { CORE: masterN - challengeN, CHALLENGE: challengeN, DISCOVERY: exploreN - surpriseN, SURPRISE: surpriseN };
    }
  }

  const picked = new Map<string, SessionItem>();
  const order: Slot[] = ['CORE', 'DISCOVERY', 'CHALLENGE', 'SURPRISE'];
  const bySlot: Record<Slot, SessionItem[]> = { CORE: [], CHALLENGE: [], DISCOVERY: [], SURPRISE: [] };
  for (const slot of order) {
    const pool = all.filter((c) => !picked.has(c.q.id) && pools[slot](c)).sort((a, b) => score[slot](b) - score[slot](a));
    for (const c of pool.slice(0, targets[slot])) {
      const it = item(c, slot, ctx);
      picked.set(c.q.id, it);
      bySlot[slot].push(it);
    }
  }
  // 不足分の補充: 未回答 → 復習・苦手 → 今日未回答のもの → 今日回答済み
  const fillers: [Slot, (c: Cand) => boolean][] = [
    ['DISCOVERY', (c) => !c.answered],
    ['CORE', (c) => !c.today && (c.due || c.weak)],
    ['CORE', (c) => !c.today],
    ['CORE', () => true],
  ];
  for (const [slot, f] of fillers) {
    if (picked.size >= n) break;
    const pool = all.filter((c) => !picked.has(c.q.id) && f(c)).sort((a, b) => score[slot](b) - score[slot](a));
    for (const c of pool.slice(0, n - picked.size)) {
      const it = item(c, slot, ctx);
      picked.set(c.q.id, it);
      bySlot[slot].push(it);
    }
  }
  const items = opt.mode === 'surprise' ? shuffle([...picked.values()], rand) : pace(bySlot, ctx, rand);
  return { items, exploreShare: explore, counts: countSlots(items) };
}

/** 試験接近・復習の溜まり・カバー率・本人の新規性志向で EXPLORE 比率を調整（基準30%） */
export function exploreShare(ctx: BuildContext, all: Cand[], n: number, daysToExam: number): number {
  let e = 0.3;
  const dueCount = all.filter((c) => c.due && !c.today).length;
  if (dueCount > n) e -= 0.1;
  if (daysToExam < 30) e -= 0.15;
  else if (daysToExam < 90) e -= 0.1;
  const coverage = all.length ? all.filter((c) => c.answered).length / all.length : 0;
  if (coverage < 0.3 && daysToExam > 180) e += 0.1;
  e += ((ctx.surpriseAffinity ?? 0.2) - 0.2) * 0.25;
  return Math.max(0.15, Math.min(0.5, e));
}

function masteryOf(all: Cand[]): number {
  const ms = all.map((c) => c.topicM).filter((m): m is number => m != null);
  return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0.5;
}

/** 直近7日の課目別回答シェア（偏り補正用） */
function subjectBias(all: Cand[], now: number): Map<SubjectId, number> {
  const since = now - 7 * DAY;
  const counts = new Map<SubjectId, number>();
  let total = 0;
  for (const c of all) {
    if ((c.card?.lastAnsweredAt ?? 0) >= since) { counts.set(c.q.subject, (counts.get(c.q.subject) ?? 0) + 1); total++; }
  }
  if (total < 6) return new Map();
  return new Map([...counts].map(([k, v]) => [k, v / total]));
}

/** 同じ誤答を2回以上選んでいれば [選択肢, 回数] */
export function repeatedWrong(card: Card | undefined): [ChoiceKey, number] | null {
  const top = Object.entries(card?.wrongChoices ?? {}).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? [top[0] as ChoiceKey, top[1]] : null;
}

export function reasonFor(c: Pick<Cand, 'card' | 'answered' | 'due' | 'weak' | 'topicM' | 'q'>, slot: Slot, ctx: BuildContext): string {
  const topicName = ctx.nodes.get(c.q.topicId)?.name ?? '';
  if (slot === 'SURPRISE') return 'Surprise：全範囲からの出題です';
  if (slot === 'CHALLENGE') return '今の実力より少し難しい問題です';
  if (c.answered && c.card) {
    const days = c.card.lastAnsweredAt ? daysBetween(c.card.lastAnsweredAt, ctx.now) : 0;
    if (c.card.flagged) return '「あとで復習」に登録した問題です';
    const rep = repeatedWrong(c.card);
    if (rep && c.card.lastResult === false) return `REVENGE：同じ誤答（${choiceLabel(rep[0])}）を${rep[1]}回選んでいる問題です`;
    if (c.card.lastResult === false) return days <= 0 ? 'さっき間違えた問題です' : `${days}日前に間違えた問題です`;
    if (c.weak && c.topicM != null) return `あなたの苦手論点です（${topicName} ${Math.round(c.topicM * 100)}%）`;
    if (c.due) return `忘却防止の復習です（前回から${days}日）`;
    return '復習の問題です';
  }
  const unlearned = (ctx.stats.get(c.q.topicId)?.answered ?? 0) === 0;
  if (unlearned && c.q.importance >= 2) return `未学習の重要論点です（${topicName}）`;
  if (unlearned) return `まだ解いていない論点です（${topicName}）`;
  return '新しい問題です';
}

function item(c: Cand, slot: Slot, ctx: BuildContext): SessionItem {
  return { questionId: c.q.id, slot, track: TRACK[slot], reason: reasonFor(c, slot, ctx) };
}

function pickOrdered(cands: Cand[], n: number, slot: Slot, ctx: BuildContext): SessionItem[] {
  return cands.slice(0, n).map((c) => item(c, slot, ctx));
}

/** 指定件数に満たないときは補充候補から足す */
function finalize(items: SessionItem[], extra: Cand[], n: number, ctx: BuildContext, slot: Slot, _rand: () => number): Plan {
  const have = new Set(items.map((i) => i.questionId));
  for (const c of extra) {
    if (items.length >= n) break;
    if (!have.has(c.q.id)) { items.push(item(c, slot, ctx)); have.add(c.q.id); }
  }
  return { items, exploreShare: 0, counts: countSlots(items) };
}

function countSlots(items: SessionItem[]): Record<Slot, number> {
  const r: Record<Slot, number> = { CORE: 0, CHALLENGE: 0, DISCOVERY: 0, SURPRISE: 0 };
  for (const i of items) r[i.slot]++;
  return r;
}

/**
 * スロットを均等に散らしつつ（最大剰余法）、同じ課目が続かないように並べる（インターリーブ）。
 * 先頭は復習（CORE）から入り、立ち上がりを軽くする。
 */
function pace(bySlot: Record<Slot, SessionItem[]>, ctx: BuildContext, rand: () => number): SessionItem[] {
  const subj = (it: SessionItem) => ctx.metas.find((m) => m.id === it.questionId)?.subject;
  const queues = Object.fromEntries(Object.entries(bySlot).map(([k, v]) => [k, [...v]])) as Record<Slot, SessionItem[]>;
  const total = Object.values(queues).reduce((a, b) => a + b.length, 0);
  const used: Record<Slot, number> = { CORE: 0, CHALLENGE: 0, DISCOVERY: 0, SURPRISE: 0 };
  const sizes = Object.fromEntries(Object.entries(queues).map(([k, v]) => [k, v.length])) as Record<Slot, number>;
  const out: SessionItem[] = [];
  let prev: SubjectId | undefined;
  for (let pos = 0; pos < total; pos++) {
    let best: Slot | null = null;
    let bestGap = -Infinity;
    for (const s of Object.keys(queues) as Slot[]) {
      if (!queues[s].length) continue;
      const gap = (sizes[s] * (pos + 1)) / total - used[s] + (pos === 0 && s === 'CORE' ? 10 : 0) + rand() * 0.01;
      if (gap > bestGap) { bestGap = gap; best = s; }
    }
    const q = queues[best!];
    let idx = q.findIndex((it) => subj(it) !== prev);
    if (idx < 0) idx = 0;
    const [it] = q.splice(idx, 1);
    used[best!]++;
    prev = subj(it);
    out.push(it);
  }
  return out;
}

function interleave(items: SessionItem[], rand: () => number): SessionItem[] {
  return shuffle(items, rand);
}

/** 模試: 大分類ごとの問題数に比例して抽出 */
function stratified(all: Cand[], n: number, rand: () => number, ctx: BuildContext, slot: Slot): SessionItem[] {
  const groups = new Map<string, Cand[]>();
  for (const c of all) {
    let id: string | null = c.q.topicId;
    let large = id;
    while (id) { const node = ctx.nodes.get(id); if (!node) break; if (node.level === 'large') { large = node.id; break; } id = node.parentId; }
    const g = groups.get(large) ?? [];
    g.push(c);
    groups.set(large, g);
  }
  const out: Cand[] = [];
  const entries = [...groups.values()].map((g) => shuffle(g, rand));
  while (out.length < n && entries.some((g) => g.length)) {
    for (const g of shuffle(entries, rand)) {
      if (out.length >= n) break;
      if (g.length && rand() < g.length / Math.max(...entries.map((e) => e.length))) out.push(g.shift()!);
    }
  }
  // 大分類順に並べる（本番の出題順に近づける）
  const orderOf = (c: Cand) => ctx.nodes.get(c.q.topicId)?.id ?? '';
  return out.sort((a, b) => orderOf(a).localeCompare(orderOf(b))).map((c) => item(c, slot, ctx));
}

/** 実力診断: 6課目から均等に、重要度が高く標準的な難易度の未回答問題 */
function diagnostic(all: Cand[], n: number, rand: () => number, ctx: BuildContext): SessionItem[] {
  const per = Math.max(1, Math.floor(n / SUBJECTS.length));
  const out: SessionItem[] = [];
  for (const s of SUBJECTS) {
    const pool = all.filter((c) => c.q.subject === s.id)
      .sort((a, b) => Number(a.answered) - Number(b.answered) || b.q.importance - a.q.importance || Math.abs(a.q.difficulty - 3) - Math.abs(b.q.difficulty - 3) || rand() - 0.5);
    const seenLarge = new Set<string>();
    for (const c of pool) {
      if (out.filter((i) => ctx.metas.find((m) => m.id === i.questionId)?.subject === s.id).length >= per) break;
      const large = ctx.nodes.get(c.q.topicId)?.parentId ?? '';
      if (seenLarge.has(large) && pool.length > per) continue;
      seenLarge.add(large);
      out.push({ questionId: c.q.id, slot: 'DISCOVERY', track: 'EXPLORE', reason: `実力診断：${SUBJECT_MAP[s.id].short}` });
    }
  }
  return shuffle(out, rand);
}

/** BOSS の出現条件（docs/04_pcm_feature_gate.md） */
export const BOSS_MIN_ANSWERED = 3;
export const BOSS_MIN_MASTERY = 0.6;
export const BOSS_MIN_DIFFICULTY = 4;

/**
 * BOSS QUESTION の候補。論点を一定以上学習して習熟度が上がったところで、
 * その論点の難問（まだ正解していない or 前回誤答）を出す。
 * 並び順: 難易度 → 計算・事例 → 論点の習熟度が高い順（学んだ論点ほど「総仕上げ」になる）
 */
export function bossCandidates(ctx: BuildContext, exclude: Set<string> = new Set()): QuestionMeta[] {
  const today0 = startOfDay(ctx.now);
  const kind = (q: QuestionMeta) => (q.type === 'calculation' ? 2 : q.type === 'case' ? 1 : 0);
  return ctx.metas
    .filter((q) => {
      if (exclude.has(q.id) || q.difficulty < BOSS_MIN_DIFFICULTY) return false;
      const st = ctx.stats.get(q.topicId);
      if (!st || st.answered < BOSS_MIN_ANSWERED || st.mastery == null || st.mastery < BOSS_MIN_MASTERY) return false;
      const card = ctx.cards.get(q.id);
      if (card?.lastResult === true) return false;
      return (card?.lastAnsweredAt ?? 0) < today0;
    })
    .sort((a, b) => b.difficulty - a.difficulty || kind(b) - kind(a)
      || (ctx.stats.get(b.topicId)!.mastery! - ctx.stats.get(a.topicId)!.mastery!));
}

export function bossReason(q: QuestionMeta, ctx: BuildContext): string {
  const st = ctx.stats.get(q.topicId);
  const name = ctx.nodes.get(q.topicId)?.name ?? '';
  return `BOSS：「${name}」の習熟度が${Math.round((st?.mastery ?? 0) * 100)}%に到達。この論点の難問です`;
}

/** 1論点から1問ずつ、最大 n 問 */
export function bossItems(ctx: BuildContext, n: number, exclude?: Set<string>): SessionItem[] {
  const seen = new Set<string>();
  const out: SessionItem[] = [];
  for (const q of bossCandidates(ctx, exclude)) {
    if (out.length >= n) break;
    if (seen.has(q.topicId)) continue;
    seen.add(q.topicId);
    out.push({ questionId: q.id, slot: 'CHALLENGE', track: 'MASTER', reason: bossReason(q, ctx), boss: true });
  }
  return out;
}
