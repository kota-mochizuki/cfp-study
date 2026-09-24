import type { Attempt, Card, QuestionMeta, QuestionType, Session, SubjectId, TaxNode, UxEvent } from '../domain/types';
import { SUBJECTS } from '../domain/subjects';
import { DAY, startOfDay } from '../lib/time';
import { MASTERED_THRESHOLD, WEAK_THRESHOLD, computeStats, replayCards, type NodeStat } from './mastery';

// ───────────────────────── 回答直後の成長メッセージ ─────────────────────────

/** 回答直後に1行で伝える「できるようになったこと」 */
export function answerInsight(before: Card | undefined, correct: boolean, timeMs: number): string | null {
  if (!correct || !before) return null;
  if (before.wrongCount >= 2 && before.correctCount === 0) return `以前${before.wrongCount}回間違えた問題を、今日は初めて正解しました`;
  if (before.lastResult === false) return '前回間違えた問題を攻略しました';
  if (before.lastResult && before.lastTimeMs && timeMs < before.lastTimeMs * 0.7 && before.lastTimeMs - timeMs > 3000)
    return `回答速度が上がりました（${Math.round(before.lastTimeMs / 1000)}秒 → ${Math.round(timeMs / 1000)}秒）`;
  return null;
}

// ───────────────────────── 今週の成長 ─────────────────────────

export interface GrowthItem { id: string; name: string; before: number; after: number }
export interface Growth {
  items: GrowthItem[];
  weakBefore: number;
  weakAfter: number;
  newlyMastered: number;
  answersThisWeek: number;
}

interface GrowthInput {
  nodes: TaxNode[];
  metas: QuestionMeta[];
  attempts: Attempt[];
  cards: Map<string, Card>;
  now: number;
  avgTimeMs: number;
  priors?: Partial<Record<SubjectId, number>>;
  intervals?: number[];
  days?: number;
}

export function growth({ nodes, metas, attempts, cards, now, avgTimeMs, priors, intervals, days = 7 }: GrowthInput): Growth {
  const asOf = now - days * DAY;
  const past = computeStats({ nodes, metas, cards: replayCards(attempts, asOf, avgTimeMs, intervals), now: asOf, priors });
  const cur = computeStats({ nodes, metas, cards, now, priors });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const items: GrowthItem[] = [];
  for (const n of nodes) {
    if (n.level === 'subject' || n.level === 'large') continue;
    const a = past.get(n.id)?.mastery, b = cur.get(n.id)?.mastery;
    if (a == null || b == null || b - a < 0.05) continue;
    items.push({ id: n.id, name: byId.get(n.id)!.name, before: a, after: b });
  }
  // 同じ系統（親子）が並ばないよう、深い論点を優先して上位5件
  items.sort((x, y) => (y.after - y.before) - (x.after - x.before));
  const topicIds = new Set(metas.map((m) => m.topicId));
  const weakCount = (s: Map<string, NodeStat>) => [...topicIds].filter((t) => { const m = s.get(t)?.mastery; return m != null && m < WEAK_THRESHOLD; }).length;
  const masteredCount = (s: Map<string, NodeStat>) => [...topicIds].filter((t) => (s.get(t)?.mastery ?? 0) >= MASTERED_THRESHOLD).length;
  return {
    items: dedupeLineage(items, byId).slice(0, 5),
    weakBefore: weakCount(past),
    weakAfter: weakCount(cur),
    newlyMastered: Math.max(0, masteredCount(cur) - masteredCount(past)),
    answersThisWeek: attempts.filter((a) => a.answeredAt > asOf).length,
  };
}

function dedupeLineage(items: GrowthItem[], byId: Map<string, TaxNode>): GrowthItem[] {
  const out: GrowthItem[] = [];
  const related = (a: string, b: string) => a.startsWith(b) || b.startsWith(a) || isAncestor(byId, a, b) || isAncestor(byId, b, a);
  for (const it of items) if (!out.some((o) => related(o.id, it.id))) out.push(it);
  return out;
}
function isAncestor(byId: Map<string, TaxNode>, anc: string, id: string): boolean {
  let cur = byId.get(id)?.parentId;
  while (cur) { if (cur === anc) return true; cur = byId.get(cur)?.parentId; }
  return false;
}

// ───────────────────────── 本番準備度（合格確率は出さない） ─────────────────────────

export interface Readiness {
  subject: SubjectId;
  recentAccuracy: number | null;
  recentN: number;
  mockScore: number | null;
  mockAt: number | null;
  coverage: number;
  weakTopics: number;
  reviewCompletion: number | null;
}

export function readiness(subject: SubjectId, stats: Map<string, NodeStat>, attempts: Attempt[], cards: Map<string, Card>, metas: Map<string, QuestionMeta>, mocks: Session[], now: number): Readiness {
  const recent = attempts.filter((a) => a.subject === subject && a.answeredAt >= now - 14 * DAY);
  const mock = mocks.filter((m) => m.subject === subject && m.endedAt).sort((a, b) => b.endedAt! - a.endedAt!)[0];
  const mockScore = mock ? Object.values(mock.answers).filter((x) => x.correct).length / mock.items.length : null;
  const s = stats.get(subject);
  // 復習完了率: 直近7日に期限が来た復習のうち、期限翌日までに解いた割合
  const since = now - 7 * DAY;
  let onTime = 0, late = 0;
  for (const a of attempts) {
    if (a.subject !== subject || a.answeredAt < since || a.dueAtBefore == null || a.dueAtBefore > a.answeredAt) continue;
    if (a.answeredAt <= a.dueAtBefore + 2 * DAY) onTime++; else late++;
  }
  const today0 = startOfDay(now);
  for (const c of cards.values()) {
    if (metas.get(c.questionId)?.subject !== subject || c.dueAt == null) continue;
    if (c.dueAt >= since && c.dueAt < today0 - DAY) late++;
  }
  return {
    subject,
    recentAccuracy: recent.length ? recent.filter((a) => a.correct).length / recent.length : null,
    recentN: recent.length,
    mockScore,
    mockAt: mock?.endedAt ?? null,
    coverage: s && s.topicsTotal ? s.topicsAnswered / s.topicsTotal : 0,
    weakTopics: s?.weakTopics ?? 0,
    reviewCompletion: onTime + late ? onTime / (onTime + late) : null,
  };
}

// ───────────────────────── My CFP Profile ─────────────────────────

export const PROFILE_MIN_ANSWERS = 100;
export const TRAITS_MIN_ANSWERS = 300;

export interface Profile {
  ready: boolean;
  remaining: number;
  strong: SubjectId[];
  stable: SubjectId[];
  growing: SubjectId[];
  focus: { subject: SubjectId; name: string; mastery: number }[];
  traits: string[];
}

export function profile(nodes: TaxNode[], metas: QuestionMeta[], attempts: Attempt[], cards: Map<string, Card>, now: number, avgTimeMs: number, priors?: Partial<Record<SubjectId, number>>): Profile {
  const remaining = Math.max(0, PROFILE_MIN_ANSWERS - attempts.length);
  const empty: Profile = { ready: false, remaining, strong: [], stable: [], growing: [], focus: [], traits: [] };
  if (remaining > 0) return empty;
  const cur = computeStats({ nodes, metas, cards, now, priors });
  const past = computeStats({ nodes, metas, cards: replayCards(attempts, now - 14 * DAY, avgTimeMs), now: now - 14 * DAY, priors });
  const p: Profile = { ...empty, ready: true };
  const deltas: { id: SubjectId; d: number }[] = [];
  for (const s of SUBJECTS) {
    const st = cur.get(s.id);
    if (!st || st.mastery == null || st.answered < 5) continue;
    const cov = st.topicsTotal ? st.topicsAnswered / st.topicsTotal : 0;
    if (st.mastery >= 0.75 && cov >= 0.3) p.strong.push(s.id);
    else if (st.mastery >= WEAK_THRESHOLD) p.stable.push(s.id);
    const before = past.get(s.id)?.mastery;
    if (before != null) deltas.push({ id: s.id, d: st.mastery - before });
  }
  p.growing = deltas.filter((x) => x.d >= 0.05).sort((a, b) => b.d - a.d).slice(0, 2).map((x) => x.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  p.focus = nodes
    .filter((n) => n.level === 'middle')
    .map((n) => ({ n, s: cur.get(n.id) }))
    .filter((x) => x.s && x.s.mastery != null && x.s.answered >= 3 && x.s.mastery < WEAK_THRESHOLD)
    .sort((a, b) => a.s!.mastery! - b.s!.mastery!)
    .slice(0, 3)
    .map(({ n, s }) => ({ subject: subjectOf(byId, n.id), name: n.name, mastery: s!.mastery! }));
  if (attempts.length >= TRAITS_MIN_ANSWERS) p.traits = traits(attempts, new Map(metas.map((m) => [m.id, m])));
  return p;
}

function subjectOf(byId: Map<string, TaxNode>, id: string): SubjectId {
  let cur = byId.get(id);
  while (cur?.parentId) cur = byId.get(cur.parentId);
  return (cur?.id ?? 'finance') as SubjectId;
}

const rate = (xs: Attempt[]) => (xs.length ? xs.filter((a) => a.correct).length / xs.length : 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const MIN_BUCKET = 20;

/** データから見える学習特性（本人も気づいていない傾向） */
export function traits(attempts: Attempt[], metas: Map<string, QuestionMeta>): string[] {
  const out: string[] = [];
  const byType = (t: QuestionType) => attempts.filter((a) => a.questionType === t);
  const know = byType('knowledge'), calc = byType('calculation');
  if (know.length >= MIN_BUCKET && calc.length >= MIN_BUCKET) {
    const d = rate(know) - rate(calc);
    if (d >= 0.15) out.push(`知識問題は強く（${pct(rate(know))}）、計算問題で失点しやすい（${pct(rate(calc))}）`);
    if (d <= -0.15) out.push(`計算問題が得意（${pct(rate(calc))}）。知識問題の取りこぼしに注意（${pct(rate(know))}）`);
    const ratio = median(calc.map((a) => a.timeMs)) / Math.max(1, median(know.map((a) => a.timeMs)));
    if (ratio >= 1.5) out.push(`計算問題の回答時間は知識問題の約${ratio.toFixed(1)}倍`);
  }
  const long = attempts.filter((a) => (metas.get(a.questionId)?.textLength ?? 0) >= 300);
  const short = attempts.filter((a) => (metas.get(a.questionId)?.textLength ?? 0) < 300);
  if (long.length >= MIN_BUCKET && short.length >= MIN_BUCKET && rate(short) - rate(long) >= 0.1)
    out.push(`長文問題でミスが増える傾向（短文${pct(rate(short))} / 長文${pct(rate(long))}）`);
  // 前回からの間隔別正答率
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);
  const last = new Map<string, Attempt>();
  const near: Attempt[] = [], far: Attempt[] = [], afterFirstCorrect: Attempt[] = [];
  for (const a of sorted) {
    const prev = last.get(a.questionId);
    if (prev) {
      const gap = (a.answeredAt - prev.answeredAt) / DAY;
      if (gap <= 7) near.push(a); else if (gap >= 21) far.push(a);
      if (prev.correct && prev.wrongCountBefore === 0 && prev.streakBefore === 0) afterFirstCorrect.push(a);
    }
    last.set(a.questionId, a);
  }
  if (near.length >= MIN_BUCKET && far.length >= MIN_BUCKET && rate(near) - rate(far) >= 0.15)
    out.push(`3週間以上空くと正答率が下がる（${pct(rate(near))} → ${pct(rate(far))}）。こまめな復習が効くタイプ`);
  if (afterFirstCorrect.length >= MIN_BUCKET && rate(afterFirstCorrect) >= 0.85)
    out.push('一度理解すると定着しやすい');
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// ───────────────────────── UX学習 ─────────────────────────

export interface UxPrefs {
  /** 問題タイプごとに詳細解説を最初から開くか */
  openExplanation: Record<QuestionType, boolean>;
  preferredMinutes: number | null;
  /** Surprise/ランダムを選ぶ割合（0〜1） */
  surpriseAffinity: number;
  modeUse: Record<string, number>;
}

/** 行動データから本人に合うUXを推定する（PCM等の仮説より実データを優先） */
export function uxPrefs(recentAttempts: Attempt[], events: UxEvent[], now: number): UxPrefs {
  const types: QuestionType[] = ['knowledge', 'calculation', 'case', 'reading'];
  const withFlag = recentAttempts.filter((a) => a.explanationOpened !== undefined);
  const openExplanation = Object.fromEntries(types.map((t) => {
    const xs = withFlag.filter((a) => a.questionType === t);
    return [t, xs.length >= 10 && xs.filter((a) => a.explanationOpened).length / xs.length >= 0.6];
  })) as Record<QuestionType, boolean>;
  const times = events.filter((e) => e.type === 'time_selected').slice(-20).map((e) => Number(e.payload.min));
  const freq = new Map<number, number>();
  for (const t of times) freq.set(t, (freq.get(t) ?? 0) + 1);
  const preferredMinutes = times.length >= 3 ? [...freq].sort((a, b) => b[1] - a[1])[0][0] : null;
  const modes = events.filter((e) => e.type === 'mode_selected' && e.at >= now - 30 * DAY);
  const modeUse: Record<string, number> = {};
  for (const e of modes) modeUse[String(e.payload.mode)] = (modeUse[String(e.payload.mode)] ?? 0) + 1;
  const surprising = (modeUse.surprise ?? 0) + (modeUse.random ?? 0);
  return { openExplanation, preferredMinutes, surpriseAffinity: modes.length >= 5 ? surprising / modes.length : 0.2, modeUse };
}
