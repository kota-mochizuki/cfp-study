import type { ChoiceKey, Question } from '../domain/types';
import { CHOICE_KEYS } from '../domain/subjects';

export interface CheckItem { key: string; label: string; ok: boolean }

const ex = (q: Question, k: ChoiceKey) => (q[`explanation_${k.toLowerCase()}` as 'explanation_a'] ?? '').trim();
/** 不正解の解説に「正しい内容」が書かれているかの目安 */
const SHOWS_CORRECT = /正しくは|ではなく|が正しい|となる|となり|である|とされ|必要|限られ|できる|できない|含まれ|=|＝|→/;

/**
 * 解説の品質チェック。すべて満たしたものだけを「解説完成」とする。
 * 未完成でも出題はできるが、画面では「解説準備中」と表示する。
 */
export function explanationChecklist(q: Question): CheckItem[] {
  const wrong = CHOICE_KEYS.filter((k) => k !== q.correct_answer);
  const items: CheckItem[] = [
    { key: 'official', label: '公式解答がある', ok: CHOICE_KEYS.includes(q.correct_answer) },
    { key: 'choices', label: '選択肢1〜4がある', ok: CHOICE_KEYS.every((k) => !!q[`choice_${k.toLowerCase()}` as 'choice_a']?.trim()) },
    { key: 'all_ex', label: '選択肢1〜4すべてに解説がある', ok: CHOICE_KEYS.every((k) => !!ex(q, k)) },
    { key: 'correct_reason', label: '正解の理由がある', ok: ex(q, q.correct_answer).length >= 8 },
    { key: 'wrong_reason', label: '不正解の理由がある', ok: wrong.every((k) => ex(q, k).length >= 8) },
    { key: 'wrong_fix', label: '不正解について正しい内容が示されている（目安）', ok: wrong.every((k) => SHOWS_CORRECT.test(ex(q, k))) },
    { key: 'point', label: 'POINTがある', ok: !!q.key_point?.trim() },
    { key: 'law', label: '法令基準日がある', ok: /^\d{4}-\d{2}-\d{2}$/.test(q.law_reference_date ?? '') },
    { key: 'verified', label: '公式解答と独立検証の答えが一致している', ok: q.verification_status === 'verified' && q.verified_answer === q.correct_answer },
  ];
  if (q.question_type === 'calculation') items.splice(7, 0, { key: 'calc', label: '計算過程がある', ok: (q.calculation_steps?.length ?? 0) >= 2 });
  return items;
}

export const isExplained = (q: Question) => explanationChecklist(q).every((i) => i.ok);

/** 検証状態を公式解答と検証結果から決める（不一致は必ず mismatch） */
export function deriveVerification(official: ChoiceKey, verified: ChoiceKey | undefined, stated?: Question['verification_status']): NonNullable<Question['verification_status']> {
  if (!verified) return stated === 'needs_review' ? 'needs_review' : 'unverified';
  if (verified !== official) return 'mismatch';
  return stated === 'needs_review' ? 'needs_review' : 'verified';
}

/** POINT を箇条に分ける（改行・「・」区切り） */
export function splitPoints(s: string | undefined): string[] {
  return (s ?? '').split(/\n|(?:^|\s)・/).map((x) => x.replace(/^[・\-\s]+/, '').trim()).filter(Boolean);
}
