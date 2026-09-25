import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { bootstrap } from '../data/bootstrap';
import { commitImport, parseFile, previewImport } from '../data/importer';
import { exportBackup, loadCore, recordAnswer, restoreBackup, searchQuestions } from '../data/repo';
import { SAMPLE_QUESTIONS } from '../data/seed/sampleQuestions';
import { buildSession } from '../engine/sessionBuilder';
import { computeStats } from '../engine/mastery';
import type { Session } from '../domain/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('データ層（IndexedDB）', () => {
  it('初回起動で論点マスタとサンプル問題が入り、2回目は重複しない', async () => {
    await bootstrap();
    await bootstrap();
    const core = await loadCore();
    expect(core.metas.length).toBe(SAMPLE_QUESTIONS.length);
    expect(core.nodes.length).toBeGreaterThan(500);
    expect(await db.caseGroups.count()).toBe(1);
  });

  it('回答 → attempts 追記と cards 更新 → 出題・習熟度に反映', async () => {
    await bootstrap();
    const core = await loadCore();
    const meta = core.metas.find((m) => m.id === 'ORIG-TAX-0001')!;
    const session: Session = { id: 's1', mode: 'daily', label: '', startedAt: Date.now(), items: [], cursor: 0, feedback: 'immediate', answers: {}, inserted: 0 };
    const r = await recordAnswer({ question: meta, session, selected: 'A', correct: false, timeMs: 30_000, at: Date.now(), avgTimeMs: 40_000, intervals: [3, 7, 14, 30], trackExplanation: true });
    expect(r.attempt.id).toBeTypeOf('number');
    expect(r.attempt.explanationOpened).toBe(false);
    expect(r.card.level).toBe(1);
    const after = await loadCore();
    const stats = computeStats({ nodes: after.nodes, metas: after.metas, cards: after.cards, now: Date.now() });
    expect(stats.get('tax')!.answered).toBe(1);
    const plan = buildSession({ metas: after.metas, cards: after.cards, stats, nodes: new Map(after.nodes.map((n) => [n.id, n])), now: Date.now(), examDate: null }, { mode: 'wrong', count: 10 });
    expect(plan.items.map((i) => i.questionId)).toEqual(['ORIG-TAX-0001']);
  });

  it('CSV インポート（日本語課目名・1〜4表記・新規論点）→ 検索', async () => {
    await bootstrap();
    const csv = [
      'question_id,subject,category_large,category_middle,topic,question_text,choice_a,choice_b,choice_c,choice_d,correct_answer,explanation,law_reference_date,law_revision_flag,key_point',
      'CSV-1,タックスプランニング,個人の所得にかかる税金その1所得税,所得税の課税標準と所得税額の計算,住宅借入金等特別控除,"住宅ローン控除に関する記述として、最も適切なものはどれか。",甲,乙,丙,丁,2,解説です,2026-04-01,確認済み,ポイント',
      'CSV-2,不明な課目,,,x,問題,a,b,c,d,1,解説,2026-04-01,,',
    ].join('\n');
    const { rows, parseErrors } = parseFile(csv, 'q.csv');
    expect(parseErrors).toEqual([]);
    const p = await previewImport(rows, [], '2026-10-01');
    expect(p.ok).toBe(1);
    expect(p.errors).toBe(1);
    expect(p.newNodes.map((n) => n.name)).toContain('住宅借入金等特別控除');
    expect(await commitImport(p, 'skip')).toBe(1);
    const q = await db.questions.get('CSV-1');
    expect(q!.correct_answer).toBe('B');
    expect(q!.subject).toBe('tax');
    const nodes = new Map((await db.nodes.toArray()).map((n) => [n.id, n]));
    expect((await searchQuestions('住宅ローン控除', nodes)).map((x) => x.question_id)).toEqual(['CSV-1']);
    expect((await searchQuestions('相続時精算課税', nodes)).length).toBeGreaterThan(0);
  });

  it('1,000問の一括インポート', async () => {
    await bootstrap();
    const rows = Array.from({ length: 1000 }, (_, i) => ({ ...SAMPLE_QUESTIONS[i % SAMPLE_QUESTIONS.length], question_id: `BULK-${i}` }));
    const t0 = performance.now();
    const p = await previewImport(rows, [], '2026-10-01');
    expect(p.ok).toBe(1000);
    expect(await commitImport(p, 'skip')).toBe(1000);
    expect(await db.qmeta.count()).toBe(1000 + SAMPLE_QUESTIONS.length);
    expect(performance.now() - t0).toBeLessThan(15_000);
  });

  it('バックアップ書き出し → 復元', async () => {
    await bootstrap();
    const json = await exportBackup();
    await db.questions.clear();
    await restoreBackup(json);
    expect(await db.questions.count()).toBe(SAMPLE_QUESTIONS.length);
    await expect(restoreBackup('{"app":"other"}')).rejects.toThrow();
  });
});

describe('サンプル問題の削除', () => {
  it('タグ「サンプル」だけ消え、他の問題・履歴は残り、再起動しても戻らない', async () => {
    const { deleteSampleQuestions } = await import('../data/repo');
    await bootstrap();
    await db.questions.put({ ...(await db.questions.get('ORIG-TAX-0001'))!, question_id: 'ORIG-MINE-1', tags: ['サンプル'] });
    await db.attempts.add({ questionId: 'ORIG-TAX-0001', sessionId: 's', answeredAt: Date.now(), selected: 'A', correct: true, timeMs: 1, mode: 'daily', streakBefore: 0, wrongCountBefore: 0, dueAtBefore: null, difficulty: 1, subject: 'tax', topicId: 'tax', questionType: 'knowledge' });
    expect(await deleteSampleQuestions()).toBe(SAMPLE_QUESTIONS.length);
    expect(await db.questions.count()).toBe(1);
    expect(await db.caseGroups.count()).toBe(0);
    expect(await db.attempts.count()).toBe(1);
    await bootstrap();
    expect(await db.questions.count()).toBe(1);
  });
});

describe('解説・検証（v2）', () => {
  it('差分インポートで既存の過去問に解説と検証結果を追記。不一致は mismatch', async () => {
    const { validateRows } = await import('../data/importer');
    const { explanationChecklist, isExplained } = await import('../data/quality');
    await bootstrap();
    const q = (await db.questions.get('ORIG-RISK-0004'))!;
    await db.questions.put({ ...q, question_id: 'PAST-X-1', explanation_a: undefined, explanation_b: undefined, explanation_c: undefined, explanation_d: undefined, key_point: '', verified_answer: undefined, verification_status: 'unverified', tags: [] });
    const patch = [
      { question_id: 'PAST-X-1', verified_answer: '1', verification_status: 'verified', explanation_short: '傷害120万円', key_point: '死亡3,000万\n傷害120万', explanation_a: '正しい。傷害は120万円である', explanation_b: '4,000万円ではなく3,000万円となる', explanation_c: '対物は含まれない。正しくは対人のみ', explanation_d: '運転者本人は対象外となる' },
      { question_id: 'ORIG-RISK-0003', official_answer: '4', verified_answer: '2', explanation_short: 'x' },
    ];
    const nodes = await db.nodes.toArray();
    const existing = new Map((await db.questions.bulkGet(['PAST-X-1', 'ORIG-RISK-0003'])).map((x) => [x!.question_id, x!]));
    const p = validateRows(patch, [], nodes, new Set(['PAST-X-1', 'ORIG-RISK-0003']), '2026-10-01', existing);
    expect(p.errors).toBe(0);
    expect(p.patches).toBe(2);
    expect(await commitImport(p, 'skip')).toBe(2);
    const after = (await db.questions.get('PAST-X-1'))!;
    expect(after.question_text).toBe(q.question_text);
    expect(after.explanation_short).toBe('傷害120万円');
    expect(after.verification_status).toBe('verified');
    expect(explanationChecklist(after).filter((c) => !c.ok)).toEqual([]);
    expect(isExplained(after)).toBe(true);
    expect((await db.qmeta.get('PAST-X-1'))!.explained).toBe(true);
    const mm = (await db.questions.get('ORIG-RISK-0003'))!;
    expect(mm.verification_status).toBe('mismatch');
    expect(isExplained(mm)).toBe(false);
  });

  it('v1 のデータベースを開くと、履歴を保ったまま v2 に移行する', async () => {
    const Dexie = (await import('dexie')).default;
    const { CfpDB } = await import('../data/db');
    await Dexie.delete('migrate-test');
    const v1 = new Dexie('migrate-test');
    v1.version(1).stores({ questions: 'question_id', qmeta: 'id', attempts: '++id, questionId', cards: 'questionId', caseGroups: 'id', nodes: 'id', sessions: 'id', favorites: 'questionId', notes: 'questionId', kv: 'key', uxEvents: '++id', devLog: '++id', ideas: '++id', reviews: '++id' });
    await v1.open();
    const q = { ...(SAMPLE_QUESTIONS[0] as object), question_id: 'Q1', topic_id: 'finance', correct_answer: 'D', question_text: 'x', related_topics: [], tags: [], law_revision_flag: 'verified', law_reference_date: '2026-04-01', verified_answer: undefined, verification_status: undefined };
    await v1.table('questions').put(q);
    await v1.table('cards').put({ questionId: 'Q1', level: 1, streak: 0, correctCount: 0, wrongCount: 2 });
    await v1.table('attempts').bulkAdd([{ questionId: 'Q1', correct: false, selected: 'C' }, { questionId: 'Q1', correct: false, selected: 'C' }, { questionId: 'Q1', correct: true, selected: 'D' }]);
    v1.close();
    const v2 = new CfpDB('migrate-test');
    await v2.open();
    expect(await v2.attempts.count()).toBe(3);
    expect((await v2.cards.get('Q1'))!.wrongChoices).toEqual({ C: 2 });
    expect((await v2.qmeta.get('Q1'))!.verification).toBe('unverified');
    v2.close();
  });
});

describe('初期データ v1 → v2', () => {
  it('残っているサンプルだけ解説を更新し、削除済みは戻さない', async () => {
    const { isExplained } = await import('../data/quality');
    await bootstrap();
    // v1 相当に戻す: 版を1にし、1問を古い解説に、1問を削除
    await db.kv.put({ key: 'seedVersion', value: 1 });
    const q = (await db.questions.get('ORIG-TAX-0001'))!;
    await db.questions.put({ ...q, explanation_a: '古い', verified_answer: undefined, verification_status: 'unverified' });
    await db.questions.delete('ORIG-TAX-0002');
    await bootstrap();
    const after = (await db.questions.get('ORIG-TAX-0001'))!;
    expect(isExplained(after)).toBe(true);
    expect(await db.questions.get('ORIG-TAX-0002')).toBeUndefined();
  });
});
