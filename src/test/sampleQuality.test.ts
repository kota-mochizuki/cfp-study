import { expect, it } from 'vitest';
import { validateRows } from '../data/importer';
import { seedNodes } from '../data/taxonomy';
import { explanationChecklist } from '../data/quality';
import { SAMPLE_QUESTIONS } from '../data/seed/sampleQuestions';

it('サンプル問題はすべて解説の品質基準を満たす', () => {
  const p = validateRows(SAMPLE_QUESTIONS, [], seedNodes(), new Set(), '2026-10-01');
  const bad = p.results.flatMap((r) => explanationChecklist(r.question!).filter((c) => !c.ok).map((c) => `${r.question!.question_id}:${c.key}`));
  expect(bad).toEqual([]);
});
