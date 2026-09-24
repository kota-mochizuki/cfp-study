import type { Attempt, Card, QuestionMeta, SubjectId, TaxNode } from '../domain/types';
import { DAY } from '../lib/time';
import { LadderScheduler, decay, emptyCard } from './scheduler';

/** 少数データの暴れ防止（事前値への疑似回答数） */
const PRIOR_STRENGTH = 1;
/** SRSの狙い: 復習期限時点で保持率≈90% */
const RETENTION_AT_DUE = 0.9;
export const WEAK_THRESHOLD = 0.6;
export const MASTERED_THRESHOLD = 0.8;

/**
 * 問題1つの習熟度（0〜1）。未回答は null。
 * 新しい回答ほど重く（半減期30日）、難問の正解は重く、遅い正解は減点、
 * 最終回答からの経過で保持率を掛ける。
 */
export function questionMastery(card: Card | undefined, now: number, prior = 0.5): number | null {
  if (!card || card.wTotal === 0 || card.lastAnsweredAt == null) return null;
  const d = decay(card.wAt, now);
  const p = (card.wScore * d + prior * PRIOR_STRENGTH) / (card.wTotal * d + PRIOR_STRENGTH);
  const days = Math.max(0, now - card.lastAnsweredAt) / DAY;
  const r = Math.pow(RETENTION_AT_DUE, days / Math.max(1, card.intervalDays));
  return p * r;
}

export interface NodeStat {
  id: string;
  /** 回答済み問題の質（重要度加重）。未回答のみなら null */
  mastery: number | null;
  /** 全問題に対する到達度（未回答=0として重要度加重）。ホームの課目バー */
  progress: number;
  answered: number;
  total: number;
  topicsTotal: number;
  topicsAnswered: number;
  weakTopics: number;
  correct: number;
  wrong: number;
  due: number;
}

export interface MasteryInput {
  nodes: TaxNode[];
  metas: QuestionMeta[];
  cards: Map<string, Card>;
  now: number;
  priors?: Partial<Record<SubjectId, number>>;
}

export function computeStats({ nodes, metas, cards, now, priors = {} }: MasteryInput): Map<string, NodeStat> {
  const parent = new Map(nodes.map((n) => [n.id, n.parentId]));
  const acc = new Map<string, { sm: number; sa: number; sAll: number; answered: number; total: number; correct: number; wrong: number; due: number; topics: Set<string>; topicsAns: Set<string> }>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { sm: 0, sa: 0, sAll: 0, answered: 0, total: 0, correct: 0, wrong: 0, due: 0, topics: new Set(), topicsAns: new Set() }));
    return a;
  };
  // 論点（topic_id）単位の習熟度 → 苦手論点数の算出に使う
  const topicAgg = new Map<string, { sm: number; sa: number }>();

  for (const q of metas) {
    const card = cards.get(q.id);
    const m = questionMastery(card, now, priors[q.subject] ?? 0.5);
    const imp = q.importance || 1;
    if (m != null) {
      const t = topicAgg.get(q.topicId) ?? { sm: 0, sa: 0 };
      t.sm += imp * m; t.sa += imp;
      topicAgg.set(q.topicId, t);
    }
    const isDue = card?.dueAt != null && card.dueAt <= now;
    let id: string | null | undefined = q.topicId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const a = get(id);
      a.total++; a.sAll += imp; a.topics.add(q.topicId);
      if (m != null) { a.answered++; a.sm += imp * m; a.sa += imp; a.topicsAns.add(q.topicId); }
      if (card) { a.correct += card.correctCount; a.wrong += card.wrongCount; }
      if (isDue) a.due++;
      id = parent.get(id);
    }
  }

  const weakTopicSet = new Set([...topicAgg].filter(([, t]) => t.sm / t.sa < WEAK_THRESHOLD).map(([id]) => id));
  const out = new Map<string, NodeStat>();
  for (const [id, a] of acc) {
    out.set(id, {
      id,
      mastery: a.sa > 0 ? a.sm / a.sa : null,
      progress: a.sAll > 0 ? a.sm / a.sAll : 0,
      answered: a.answered, total: a.total,
      topicsTotal: a.topics.size, topicsAnswered: a.topicsAns.size,
      weakTopics: [...a.topics].filter((t) => weakTopicSet.has(t)).length,
      correct: a.correct, wrong: a.wrong, due: a.due,
    });
  }
  return out;
}

/** 過去時点（asOf）のカード状態を回答履歴から再構成する（成長の比較用） */
export function replayCards(attempts: Attempt[], asOf: number, avgTimeMs: number, intervals?: number[]): Map<string, Card> {
  const sch = new LadderScheduler(intervals);
  const cards = new Map<string, Card>();
  const sorted = attempts.filter((a) => a.answeredAt <= asOf).sort((a, b) => a.answeredAt - b.answeredAt);
  for (const a of sorted) {
    const c = cards.get(a.questionId) ?? emptyCard(a.questionId);
    cards.set(a.questionId, sch.review(c, {
      correct: a.correct, at: a.answeredAt, timeMs: a.timeMs, difficulty: a.difficulty, selfRating: a.selfRating, avgTimeMs,
    }));
  }
  return cards;
}

export function nodePath(nodes: Map<string, TaxNode>, id: string): TaxNode[] {
  const path: TaxNode[] = [];
  let cur = nodes.get(id);
  while (cur) { path.unshift(cur); cur = cur.parentId ? nodes.get(cur.parentId) : undefined; }
  return path;
}

/** 弱点TOP N（論点単位、回答済みのみ） */
export function weakest(stats: Map<string, NodeStat>, metas: QuestionMeta[], n = 5): NodeStat[] {
  const topicIds = new Set(metas.map((m) => m.topicId));
  return [...topicIds]
    .map((id) => stats.get(id))
    .filter((s): s is NodeStat => !!s && s.mastery != null && s.mastery < WEAK_THRESHOLD)
    .sort((a, b) => (a.mastery! - b.mastery!) || (b.wrong - a.wrong))
    .slice(0, n);
}
