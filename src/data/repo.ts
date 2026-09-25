import type { Attempt, Card, CaseGroup, Question, QuestionMeta, Session, Settings, TaxNode, UxEvent } from '../domain/types';
import { DEFAULT_INTERVALS, LadderScheduler, emptyCard } from '../engine/scheduler';
import { ALL_TABLES, db } from './db';
import { toMeta } from './taxonomy';
import { SAMPLE_QUESTIONS } from './seed/sampleQuestions';

/**
 * データアクセスはすべてここを経由する。
 * 将来 Firestore 同期を入れる場合もこの層を差し替える。
 */

export const DEFAULT_SETTINGS: Settings = {
  examDate: '2027-06-13',
  // 第1回（6月）試験は前年10月1日施行法令が基準となるのが通例。試験要項の公表後に要確認
  lawBaseDate: '2026-10-01',
  passLineRatio: 0.56,
  simpleHome: false,
  shuffleChoices: false,
  includeOutdated: false,
  theme: 'auto',
  defaultMinutes: 10,
  secPerQuestion: 60,
  priors: {},
  diagnosticDone: false,
  intervals: DEFAULT_INTERVALS,
};

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}
export async function saveSettings(s: Settings) {
  await db.kv.put({ key: 'settings', value: s });
}

export interface Core {
  metas: QuestionMeta[];
  cards: Map<string, Card>;
  nodes: TaxNode[];
  favorites: Set<string>;
  settings: Settings;
}

/** 起動時に読むのは軽量データのみ（問題本文は出題時に個別取得） */
export async function loadCore(): Promise<Core> {
  const [metas, cards, nodes, favs, settings] = await Promise.all([
    db.qmeta.toArray(), db.cards.toArray(), db.nodes.toArray(), db.favorites.toCollection().primaryKeys(), getSettings(),
  ]);
  return { metas, cards: new Map(cards.map((c) => [c.questionId, c])), nodes, favorites: new Set(favs), settings };
}

export const getQuestion = (id: string) => db.questions.get(id);
export async function getQuestions(ids: string[]): Promise<Map<string, Question>> {
  const qs = await db.questions.bulkGet(ids);
  return new Map(qs.filter((q): q is Question => !!q).map((q) => [q.question_id, q]));
}
export const getCaseGroup = (id: string): Promise<CaseGroup | undefined> => db.caseGroups.get(id);

export async function saveQuestion(q: Question) {
  await db.transaction('rw', db.questions, db.qmeta, async () => {
    await db.questions.put(q);
    await db.qmeta.put(toMeta(q));
  });
}
export async function deleteQuestion(id: string) {
  await db.transaction('rw', db.questions, db.qmeta, db.cards, db.favorites, db.notes, async () => {
    await Promise.all([db.questions.delete(id), db.qmeta.delete(id), db.cards.delete(id), db.favorites.delete(id), db.notes.delete(id)]);
  });
}

/** 同梱サンプル問題の ID（自分で作った ORIG- 問題と区別するため ID 一覧で判定） */
export const SAMPLE_IDS = new Set(SAMPLE_QUESTIONS.map((r) => String(r.question_id)));

/** 同梱サンプル問題の一括削除。回答履歴は残す。削除後は再投入されない */
export async function deleteSampleQuestions(): Promise<number> {
  const ids = (await db.questions.bulkGet([...SAMPLE_IDS])).filter((q) => q?.tags.includes('サンプル')).map((q) => q!.question_id);
  const groups = new Set((await db.questions.bulkGet(ids)).map((q) => q?.case_group_id).filter(Boolean) as string[]);
  await db.transaction('rw', [db.questions, db.qmeta, db.cards, db.favorites, db.notes, db.caseGroups], async () => {
    await Promise.all([db.questions.bulkDelete(ids), db.qmeta.bulkDelete(ids), db.cards.bulkDelete(ids), db.favorites.bulkDelete(ids), db.notes.bulkDelete(ids)]);
    // 他の問題が使っていない事例だけ削除
    for (const g of groups) if (!(await db.questions.where('case_group_id').equals(g).count())) await db.caseGroups.delete(g);
  });
  return ids.length;
}

export interface AnswerInput {
  question: QuestionMeta;
  session: Session;
  slot?: Attempt['slot'];
  track?: Attempt['track'];
  reason?: string;
  selected: Attempt['selected'];
  correct: boolean;
  timeMs: number;
  at: number;
  avgTimeMs: number;
  intervals: number[];
  /** 解説の開封を記録するか（既定で開いている場合は記録しない） */
  trackExplanation?: boolean;
}

/** 回答1件 = attempts 追記 + cards 更新（同一トランザクション） */
export async function recordAnswer(inp: AnswerInput): Promise<{ attempt: Attempt; before: Card | undefined; card: Card }> {
  return db.transaction('rw', db.attempts, db.cards, async () => {
    const before = await db.cards.get(inp.question.id);
    const card = new LadderScheduler(inp.intervals).review(before ?? emptyCard(inp.question.id), {
      correct: inp.correct, at: inp.at, timeMs: inp.timeMs, difficulty: inp.question.difficulty, avgTimeMs: inp.avgTimeMs,
    });
    if (!inp.correct && inp.selected) card.wrongChoices = { ...card.wrongChoices, [inp.selected]: (card.wrongChoices?.[inp.selected] ?? 0) + 1 };
    const attempt: Attempt = {
      questionId: inp.question.id, sessionId: inp.session.id, answeredAt: inp.at, selected: inp.selected, correct: inp.correct,
      timeMs: inp.timeMs, mode: inp.session.mode, slot: inp.slot, track: inp.track, reason: inp.reason,
      streakBefore: before?.streak ?? 0, wrongCountBefore: before?.wrongCount ?? 0, dueAtBefore: before?.dueAt ?? null,
      difficulty: inp.question.difficulty, subject: inp.question.subject, topicId: inp.question.topicId, questionType: inp.question.type,
      ...(inp.trackExplanation ? { explanationOpened: false } : {}),
    };
    attempt.id = await db.attempts.add(attempt);
    await db.cards.put(card);
    return { attempt, before, card };
  });
}

export async function updateAttempt(id: number, patch: Partial<Attempt>) {
  await db.attempts.update(id, patch);
}

/** 自己評価で復習間隔を付け直す */
export async function rateAnswer(attemptId: number, questionId: string, rating: 1 | 2 | 3, intervals: number[]): Promise<Card | undefined> {
  await db.attempts.update(attemptId, { selfRating: rating });
  const card = await db.cards.get(questionId);
  if (!card) return undefined;
  const next = new LadderScheduler(intervals).rerate(card, rating);
  await db.cards.put(next);
  return next;
}

export async function setFlagged(questionId: string, flagged: boolean): Promise<Card> {
  const card = (await db.cards.get(questionId)) ?? emptyCard(questionId);
  const next = { ...card, flagged };
  await db.cards.put(next);
  return next;
}

export async function toggleFavorite(questionId: string): Promise<boolean> {
  if (await db.favorites.get(questionId)) { await db.favorites.delete(questionId); return false; }
  await db.favorites.put({ questionId, at: Date.now() });
  return true;
}

export const getNote = async (questionId: string) => (await db.notes.get(questionId))?.text ?? '';
export async function saveNote(questionId: string, text: string) {
  if (text.trim()) await db.notes.put({ questionId, text, updatedAt: Date.now() });
  else await db.notes.delete(questionId);
}

export const saveSession = (s: Session) => db.sessions.put(s);
export const getSession = (id: string) => db.sessions.get(id);

/** 12時間以内の未完了セッション（「続きから」用） */
export async function activeSession(now = Date.now()): Promise<Session | undefined> {
  const recent = await db.sessions.where('startedAt').above(now - 12 * 3600_000).reverse().sortBy('startedAt');
  return recent.find((s) => !s.endedAt && s.mode !== 'single' && s.cursor < s.items.length);
}

export const allAttempts = () => db.attempts.toArray();
export const attemptsSince = (t: number) => db.attempts.where('answeredAt').above(t).toArray();
export const sessionAttempts = (sessionId: string) => db.attempts.where('sessionId').equals(sessionId).toArray();
export const completedMocks = async () => (await db.sessions.where('mode').equals('mock').toArray()).filter((s) => s.endedAt);
export const allSessions = () => db.sessions.toArray();

export async function logEvent(type: UxEvent['type'], payload: Record<string, unknown> = {}) {
  await db.uxEvents.add({ type, at: Date.now(), payload });
}
export const allEvents = () => db.uxEvents.toArray();

/** 問題・論点・キーワード検索（全文を走査。1万問でも数百ms） */
export async function searchQuestions(query: string, nodes: Map<string, TaxNode>, limit = 100): Promise<Question[]> {
  const terms = query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: Question[] = [];
  await db.questions.each((q) => {
    if (out.length >= limit) return;
    const hay = [
      q.question_text, q.topic, q.category_large, q.category_middle, q.category_small, q.key_point, q.explanation,
      q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.tags.join(' '), q.related_topics.join(' '), nodes.get(q.topic_id)?.name,
    ].join('\n').normalize('NFKC').toLowerCase();
    if (terms.every((t) => hay.includes(t))) out.push(q);
  });
  return out;
}

// ───────────── バックアップ（機種変更・PC移行用） ─────────────

export async function exportBackup(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of ALL_TABLES) data[t] = await db.table(t).toArray();
  return JSON.stringify({ app: 'cfp-study', version: 1, exportedAt: new Date().toISOString(), data });
}

export async function restoreBackup(json: string) {
  const parsed = JSON.parse(json);
  if (parsed.app !== 'cfp-study' || !parsed.data) throw new Error('CFP Study のバックアップファイルではありません');
  await db.transaction('rw', ALL_TABLES.map((t) => db.table(t)), async () => {
    for (const t of ALL_TABLES) {
      await db.table(t).clear();
      if (parsed.data[t]?.length) await db.table(t).bulkAdd(parsed.data[t]);
    }
  });
}
