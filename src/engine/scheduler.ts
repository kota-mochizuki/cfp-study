import type { Card } from '../domain/types';
import { DAY, startOfDay } from '../lib/time';

/**
 * 復習スケジューラ。差し替え可能にするため interface で定義し、
 * 既定実装は「連続正解数 → 間隔表」方式（設定 intervals で変更可）。
 */
export interface Scheduler {
  review(card: Card, input: ReviewInput): Card;
}

export interface ReviewInput {
  correct: boolean;
  at: number;
  timeMs: number;
  difficulty: number;
  selfRating?: 1 | 2 | 3;
  /** 本人の平均回答時間（遅い正解の判定用） */
  avgTimeMs: number;
}

/** 連続正解1/2/3/4回 → 3/7/14/30日。以降は2倍（上限90日）。不正解は翌日。 */
export const DEFAULT_INTERVALS = [3, 7, 14, 30];
export const MAX_INTERVAL = 90;
/** 習熟度の時間減衰（半減期） */
export const HALF_LIFE_DAYS = 30;

export function emptyCard(questionId: string): Card {
  return {
    questionId, level: 0, streak: 0, correctCount: 0, wrongCount: 0,
    lastAnsweredAt: null, lastResult: null, lastTimeMs: null, dueAt: null, intervalDays: 0,
    flagged: false, wScore: 0, wTotal: 0, wAt: null,
  };
}

export function levelOf(c: Pick<Card, 'streak' | 'lastResult' | 'correctCount' | 'wrongCount'>): Card['level'] {
  if (c.correctCount + c.wrongCount === 0) return 0;
  if (c.lastResult === false) return 1;
  if (c.streak >= 4) return 4;
  if (c.streak >= 2) return 3;
  return 2;
}

/** 1回の回答の得点と重み（習熟度用） */
export function attemptScore(input: Pick<ReviewInput, 'correct' | 'timeMs' | 'difficulty' | 'avgTimeMs'>) {
  const slow = input.timeMs > input.avgTimeMs * 2.5;
  const score = input.correct ? (slow ? 0.8 : 1) : 0;
  const weight = 1 + 0.15 * (input.difficulty - 3);
  return { score, weight };
}

export const decay = (fromAt: number | null, toAt: number) =>
  fromAt == null ? 1 : Math.pow(0.5, Math.max(0, toAt - fromAt) / DAY / HALF_LIFE_DAYS);

export class LadderScheduler implements Scheduler {
  constructor(private intervals: number[] = DEFAULT_INTERVALS) {}

  intervalFor(streak: number): number {
    const t = this.intervals;
    if (streak <= t.length) return t[streak - 1];
    return Math.min(MAX_INTERVAL, t[t.length - 1] * 2 ** (streak - t.length));
  }

  review(card: Card, input: ReviewInput): Card {
    const c = { ...card };
    if (input.correct) {
      c.streak += 1;
      c.correctCount += 1;
      let interval = this.intervalFor(c.streak);
      // たまたま正解・迷った正解は間隔を詰める
      if (input.timeMs > input.avgTimeMs * 2.5 && c.streak > 1) interval = this.intervalFor(c.streak - 1);
      if (input.selfRating === 3) interval = Math.max(1, Math.round(interval * 0.6));
      if (input.selfRating === 1) interval = Math.round(interval * 1.3);
      c.intervalDays = interval;
    } else {
      c.streak = 0;
      c.wrongCount += 1;
      c.intervalDays = 1;
    }
    c.lastResult = input.correct;
    c.lastAnsweredAt = input.at;
    c.lastTimeMs = input.timeMs;
    c.dueAt = startOfDay(input.at) + c.intervalDays * DAY;
    c.level = levelOf(c);
    const { score, weight } = attemptScore(input);
    const d = decay(c.wAt, input.at);
    c.wScore = c.wScore * d + score * weight;
    c.wTotal = c.wTotal * d + weight;
    c.wAt = input.at;
    return c;
  }

  /** 回答後に自己評価だけ変わった場合、間隔を付け直す */
  rerate(card: Card, selfRating: 1 | 2 | 3): Card {
    if (!card.lastResult || card.lastAnsweredAt == null) return card;
    let interval = this.intervalFor(card.streak);
    if (selfRating === 3) interval = Math.max(1, Math.round(interval * 0.6));
    if (selfRating === 1) interval = Math.round(interval * 1.3);
    return { ...card, intervalDays: interval, dueAt: startOfDay(card.lastAnsweredAt) + interval * DAY };
  }
}
