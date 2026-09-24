import type { Card, QuestionMeta, Session, SessionItem, TaxNode } from '../domain/types';
import { startOfDay } from '../lib/time';

export const MAX_INSERTS = 3;
const GAP = 2;

/**
 * セッション内アダプティブ出題。
 * 誤答 → 2問後に同論点の別問題（別角度）→ 正解 → 同論点のやや難しい問題 → 以後はSRSが数日後に再確認。
 * 同じ問題の繰り返しではなく「論点を理解したか」を確かめる。
 */
export function followUp(
  session: Session,
  answered: SessionItem,
  correct: boolean,
  metas: Map<string, QuestionMeta>,
  cards: Map<string, Card>,
  nodes: Map<string, TaxNode>,
  now: number,
): SessionItem | null {
  if (session.feedback !== 'immediate' || session.inserted >= MAX_INSERTS) return null;
  const q = metas.get(answered.questionId);
  if (!q) return null;
  let stage: 1 | 2 | null = null;
  if (!correct && !answered.followOf) stage = 1;
  else if (correct && answered.followStage === 1) stage = 2;
  if (!stage) return null;

  const inSession = new Set(session.items.map((i) => i.questionId));
  const today0 = startOfDay(now);
  const topicName = nodes.get(q.topicId)?.name ?? '同じ論点';
  // 同論点 → 見つからなければ1つ上の分類まで広げる
  const scopes = [q.topicId, nodes.get(q.topicId)?.parentId].filter(Boolean) as string[];
  for (const scopeId of scopes) {
    const cands = [...metas.values()].filter((m) => {
      if (inSession.has(m.id) || m.id === q.id) return false;
      if (m.topicId !== scopeId && nodes.get(m.topicId)?.parentId !== scopeId) return false;
      if ((cards.get(m.id)?.lastAnsweredAt ?? 0) >= today0) return false;
      return stage === 1 ? m.difficulty <= q.difficulty + 1 : m.difficulty > q.difficulty - 0;
    });
    if (!cands.length) continue;
    cands.sort((a, b) => {
      const ua = cards.get(a.id) ? 1 : 0, ub = cards.get(b.id) ? 1 : 0;
      if (ua !== ub) return ua - ub; // 未回答を優先
      return stage === 1 ? Math.abs(a.difficulty - q.difficulty) - Math.abs(b.difficulty - q.difficulty) : a.difficulty - b.difficulty;
    });
    const pick = cands[0];
    return {
      questionId: pick.id,
      slot: 'CORE',
      track: 'MASTER',
      followOf: answered.followOf ?? q.id,
      followStage: stage,
      reason: stage === 1 ? `さっき間違えた「${topicName}」を別角度から確認します` : `理解の確認：「${topicName}」の少し難しい問題です`,
    };
  }
  return null;
}

export function insertFollowUp(session: Session, it: SessionItem): Session {
  const items = [...session.items];
  const at = Math.min(items.length, session.cursor + 1 + GAP);
  items.splice(at, 0, it);
  return { ...session, items, inserted: session.inserted + 1 };
}
