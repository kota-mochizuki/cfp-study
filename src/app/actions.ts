import type { Session, SessionMode, SubjectId } from '../domain/types';
import { MODE_LABELS, SUBJECT_MAP } from '../domain/subjects';
import { buildSession, type BuildContext, type Plan } from '../engine/sessionBuilder';
import { logEvent, saveSession } from '../data/repo';
import { parseYmd } from '../lib/time';
import { uid } from '../lib/random';
import type { useApp } from './store';

type App = ReturnType<typeof useApp>;

export const MOCK_COUNT = 50;
export const MOCK_MINUTES = 120;

export function buildContext(app: App): BuildContext {
  return {
    metas: app.activeMetas, cards: app.cards, stats: app.stats, nodes: app.nodeMap, now: Date.now(),
    examDate: app.settings.examDate ? parseYmd(app.settings.examDate) : null, favorites: app.favorites,
    surpriseAffinity: app.prefs.surpriseAffinity,
  };
}

export interface StartOptions {
  count: number;
  scopeNodeId?: string;
  timeBudgetMin?: number;
  /** ホームでプレビュー済みの計画をそのまま使う */
  plan?: Plan;
  label?: string;
  questionIds?: string[];
}

const DEFERRED: SessionMode[] = ['test10', 'mock'];

export async function startSession(app: App, mode: SessionMode, opt: StartOptions): Promise<Session | null> {
  const items = opt.questionIds
    ? opt.questionIds.map((id) => ({ questionId: id, slot: 'CORE' as const, track: 'MASTER' as const, reason: '選んだ問題です' }))
    : (opt.plan ?? buildSession(buildContext(app), { mode, count: opt.count, scopeNodeId: opt.scopeNodeId })).items;
  if (!items.length) return null;
  const subject = mode === 'mock' ? (opt.scopeNodeId as SubjectId) : undefined;
  const session: Session = {
    id: uid(), mode, label: opt.label ?? (subject ? `${MODE_LABELS.mock}：${SUBJECT_MAP[subject].name}` : MODE_LABELS[mode]),
    startedAt: Date.now(), items, cursor: 0, feedback: DEFERRED.includes(mode) ? 'deferred' : 'immediate',
    timeLimitMs: mode === 'mock' ? MOCK_MINUTES * 60_000 : undefined, timeBudgetMin: opt.timeBudgetMin, subject,
    answers: {}, marked: [], inserted: 0,
  };
  await saveSession(session);
  await logEvent('mode_selected', { mode, count: items.length, scope: opt.scopeNodeId ?? null });
  return session;
}

export function sessionPath(s: Session) {
  return s.mode === 'mock' ? `/mock/${s.id}` : `/play/${s.id}`;
}
