import Dexie, { type Table } from 'dexie';
import { toMeta } from './taxonomy';
import type {
  Attempt, Card, CaseGroup, DevLog, Idea, Question, QuestionMeta, Session, TaxNode, UxEvent, WeeklyReview,
} from '../domain/types';

export interface Favorite { questionId: string; at: number }
export interface Note { questionId: string; text: string; updatedAt: number }
export interface KV { key: string; value: unknown }

export class CfpDB extends Dexie {
  questions!: Table<Question, string>;
  qmeta!: Table<QuestionMeta, string>;
  caseGroups!: Table<CaseGroup, string>;
  nodes!: Table<TaxNode, string>;
  attempts!: Table<Attempt, number>;
  cards!: Table<Card, string>;
  sessions!: Table<Session, string>;
  favorites!: Table<Favorite, string>;
  notes!: Table<Note, string>;
  kv!: Table<KV, string>;
  uxEvents!: Table<UxEvent, number>;
  devLog!: Table<DevLog, number>;
  ideas!: Table<Idea, number>;
  reviews!: Table<WeeklyReview, number>;

  constructor(name = 'cfp-study') {
    super(name);
    this.version(1).stores({
      questions: 'question_id, subject, topic_id, source_type, law_revision_flag, status, case_group_id, source_year',
      qmeta: 'id, subject, topicId',
      caseGroups: 'id',
      nodes: 'id, parentId, level',
      attempts: '++id, questionId, sessionId, answeredAt, subject',
      cards: 'questionId, dueAt',
      sessions: 'id, mode, startedAt, endedAt',
      favorites: 'questionId',
      notes: 'questionId',
      kv: 'key',
      uxEvents: '++id, type, at',
      devLog: '++id, at',
      ideas: '++id, createdAt',
      reviews: '++id, at',
    });
    // v2: 解説・検証フィールドの追加。問題本文と回答履歴はそのまま。
    // 出題用インデックス（qmeta）を作り直し、回答履歴から「誤答で選んだ選択肢の回数」を復元する。
    this.version(2).stores({}).upgrade(async (tx) => {
      const questions = await tx.table('questions').toArray();
      await tx.table('qmeta').bulkPut(questions.map((q) => toMeta({ ...q, verification_status: q.verification_status ?? 'unverified' })));
      const counts = new Map<string, Record<string, number>>();
      await tx.table('attempts').each((a: Attempt) => {
        if (a.correct || !a.selected) return;
        const m = counts.get(a.questionId) ?? {};
        m[a.selected] = (m[a.selected] ?? 0) + 1;
        counts.set(a.questionId, m);
      });
      await tx.table('cards').toCollection().modify((c: Card) => { const m = counts.get(c.questionId); if (m) c.wrongChoices = m; });
    });
  }
}

export const db = new CfpDB();

export const ALL_TABLES = [
  'questions', 'qmeta', 'caseGroups', 'nodes', 'attempts', 'cards', 'sessions', 'favorites', 'notes', 'kv',
  'uxEvents', 'devLog', 'ideas', 'reviews',
] as const;
