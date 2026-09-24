import Dexie, { type Table } from 'dexie';
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
  }
}

export const db = new CfpDB();

export const ALL_TABLES = [
  'questions', 'qmeta', 'caseGroups', 'nodes', 'attempts', 'cards', 'sessions', 'favorites', 'notes', 'kv',
  'uxEvents', 'devLog', 'ideas', 'reviews',
] as const;
