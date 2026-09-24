import type { Attempt } from '../domain/types';
import { DAY, startOfDay, startOfWeek } from '../lib/time';

/** 1問あたりの読解・解説時間の加算（回答時間だけでは学習時間を過小評価するため） */
const REVIEW_MS = 20_000;

export function studyMs(attempts: Attempt[]): number {
  const bySession = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const arr = bySession.get(a.sessionId) ?? [];
    arr.push(a);
    bySession.set(a.sessionId, arr);
  }
  let total = 0;
  for (const xs of bySession.values()) {
    // セッション内の実経過時間（放置を除くため1問あたり最大5分）
    const sorted = xs.sort((a, b) => a.answeredAt - b.answeredAt);
    total += sorted[0].timeMs + REVIEW_MS;
    for (let i = 1; i < sorted.length; i++) total += Math.min(5 * 60_000, sorted[i].answeredAt - sorted[i - 1].answeredAt);
  }
  return total;
}

export function streakDays(attempts: Attempt[], now: number): number {
  const days = new Set(attempts.map((a) => startOfDay(a.answeredAt)));
  let d = startOfDay(now);
  if (!days.has(d)) d -= DAY; // 今日まだでも昨日まで続いていれば継続中
  let n = 0;
  while (days.has(d)) { n++; d -= DAY; }
  return n;
}

export interface Activity {
  total: number;
  accuracy: number | null;
  today: number;
  week: number;
  studyMs: number;
  weekStudyMs: number;
  streak: number;
}

export function activity(attempts: Attempt[], now: number): Activity {
  const today0 = startOfDay(now);
  const week0 = startOfWeek(now);
  const week = attempts.filter((a) => a.answeredAt >= week0);
  return {
    total: attempts.length,
    accuracy: attempts.length ? attempts.filter((a) => a.correct).length / attempts.length : null,
    today: attempts.filter((a) => a.answeredAt >= today0).length,
    week: week.length,
    studyMs: studyMs(attempts),
    weekStudyMs: studyMs(week),
    streak: streakDays(attempts, now),
  };
}
