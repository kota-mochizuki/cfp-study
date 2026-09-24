import { describe, expect, it } from 'vitest';
import type { Card, CaseGroup, Question, Session, TaxNode } from '../domain/types';
import { LadderScheduler, emptyCard, levelOf } from '../engine/scheduler';
import { computeStats, questionMastery, replayCards, weakest } from '../engine/mastery';
import { buildSession, countForMinutes } from '../engine/sessionBuilder';
import { followUp, insertFollowUp } from '../engine/adaptive';
import { answerInsight, growth } from '../engine/insights';
import { validateRows } from '../data/importer';
import { lawWarning, parseAnswer, parseDate } from '../data/validate';
import { seedNodes, toMeta } from '../data/taxonomy';
import { SAMPLE_CASE_GROUPS, SAMPLE_QUESTIONS } from '../data/seed/sampleQuestions';
import { DAY, startOfDay } from '../lib/time';
import { rng } from '../lib/random';

const NOW = new Date(2026, 8, 24, 9, 0).getTime();
const AVG = 40_000;

function sample() {
  const nodes = seedNodes();
  const p = validateRows(SAMPLE_QUESTIONS, SAMPLE_CASE_GROUPS as CaseGroup[], nodes, new Set(), '2026-10-01');
  const qs = p.results.map((r) => r.question!).filter(Boolean) as Question[];
  const allNodes: TaxNode[] = [...nodes, ...p.newNodes];
  return { p, qs, nodes: allNodes, metas: qs.map(toMeta), nodeMap: new Map(allNodes.map((n) => [n.id, n])) };
}

describe('scheduler', () => {
  const s = new LadderScheduler();
  const ans = (c: Card, correct: boolean, at = NOW, extra = {}) => s.review(c, { correct, at, timeMs: 30_000, difficulty: 3, avgTimeMs: AVG, ...extra });

  it('連続正解で 3→7→14→30 日、以降は2倍（上限90）', () => {
    let c = emptyCard('q');
    const got: number[] = [];
    for (let i = 0; i < 6; i++) { c = ans(c, true); got.push(c.intervalDays); }
    expect(got).toEqual([3, 7, 14, 30, 60, 90]);
    expect(c.level).toBe(4);
  });

  it('不正解は翌日・レベル1（苦手）・連続リセット', () => {
    let c = ans(ans(emptyCard('q'), true), false);
    expect(c.intervalDays).toBe(1);
    expect(c.streak).toBe(0);
    expect(c.level).toBe(1);
    expect(c.dueAt).toBe(startOfDay(NOW) + DAY);
    c = ans(c, true);
    expect(c.level).toBe(2);
  });

  it('自己評価「難しい」は間隔を短く、「簡単」は長く', () => {
    const c = ans(emptyCard('q'), true);
    expect(s.rerate(c, 3).intervalDays).toBe(2);
    expect(s.rerate(c, 1).intervalDays).toBe(4);
  });

  it('遅い正解は1段階手前の間隔', () => {
    const c = ans(ans(emptyCard('q'), true), true, NOW, { timeMs: AVG * 3 });
    expect(c.intervalDays).toBe(3);
  });

  it('level の境界', () => {
    expect(levelOf({ streak: 0, lastResult: null, correctCount: 0, wrongCount: 0 })).toBe(0);
    expect(levelOf({ streak: 3, lastResult: true, correctCount: 3, wrongCount: 0 })).toBe(3);
  });
});

describe('import validation', () => {
  it('サンプル問題はすべてエラーなしで取り込め、学習ガイドの体系に紐づく', () => {
    const { p, qs, nodeMap } = sample();
    expect(p.errors).toBe(0);
    expect(qs.length).toBe(SAMPLE_QUESTIONS.length);
    const bond = qs.find((q) => q.question_id === 'ORIG-FIN-0001')!;
    // 金融 > リターンとリスクの評価 > 債券と金利 > 金利と利回り > 最終利回り
    expect(bond.topic_id.startsWith('finance.L02.M06.S01')).toBe(true);
    expect(nodeMap.get(bond.topic_id)!.level).toBe('topic');
    expect(p.caseGroups.map((g) => g.id)).toContain('CASE-INH-01');
  });

  it('必須欠落・正解番号不正・選択肢不足・重複・法令基準日不正を検出', () => {
    const nodes = seedNodes();
    const good = SAMPLE_QUESTIONS[0];
    const rows = [
      { ...good, question_id: 'X1', correct_answer: 'E' },
      { ...good, question_id: 'X2', choice_d: '' },
      { ...good, question_id: 'X3', law_reference_date: '2026-13-01' },
      { ...good, question_id: 'X4', law_reference_date: '' },
      { ...good, question_id: 'X5', subject: '簿記' },
      { ...good, question_id: 'X6', choice_b: good.choice_a },
      { ...good, question_id: 'X1' },
      { ...good, question_id: 'EXIST', correct_answer: '4' },
    ];
    const p = validateRows(rows, [], nodes, new Set(['EXIST']), '2026-10-01');
    const errs = p.results.map((r) => r.errors.join('|'));
    expect(errs[0]).toMatch(/正解/);
    expect(errs[1]).toMatch(/選択肢が不足/);
    expect(errs[2]).toMatch(/法令基準日/);
    expect(errs[3]).toMatch(/law_reference_date/);
    expect(errs[4]).toMatch(/課目/);
    expect(errs[5]).toMatch(/同じ内容/);
    expect(errs[6]).toMatch(/重複/);
    expect(p.results[7].errors).toEqual([]);
    expect(p.results[7].exists).toBe(true);
    expect(p.results[7].question!.correct_answer).toBe('D');
  });

  it('正解・日付の表記ゆれを受け付ける', () => {
    expect(parseAnswer('３')).toBe('C');
    expect(parseAnswer('b')).toBe('B');
    expect(parseDate('2027/1/1')).toBe('2027-01-01');
    expect(parseDate('2027年4月1日')).toBe('2027-04-01');
  });

  it('旧制度・要確認の法改正警告', () => {
    expect(lawWarning({ law_revision_flag: 'outdated', law_reference_date: '2023-04-01' }, '2026-10-01')).toMatch(/旧制度/);
    expect(lawWarning({ law_revision_flag: 'needs_check', law_reference_date: '2026-04-01' }, '2026-10-01')).toMatch(/異なる可能性/);
    expect(lawWarning({ law_revision_flag: 'verified', law_reference_date: '2026-04-01' }, '2026-10-01')).toBeNull();
  });
});

describe('mastery', () => {
  it('新しい回答ほど重く、時間とともに保持率で下がる', () => {
    const s = new LadderScheduler();
    const c = s.review(emptyCard('q'), { correct: true, at: NOW, timeMs: 20_000, difficulty: 3, avgTimeMs: AVG });
    const m0 = questionMastery(c, NOW)!;
    const m30 = questionMastery(c, NOW + 30 * DAY)!;
    expect(m0).toBeCloseTo(0.75, 2);
    expect(m30).toBeLessThan(m0);
    expect(questionMastery(undefined, NOW)).toBeNull();
  });

  it('階層ごとに集計され、弱点TOPが取れる', () => {
    const { metas, nodes } = sample();
    const s = new LadderScheduler();
    const cards = new Map<string, Card>();
    const put = (id: string, correct: boolean) => cards.set(id, s.review(cards.get(id) ?? emptyCard(id), { correct, at: NOW, timeMs: 20_000, difficulty: 3, avgTimeMs: AVG }));
    put('ORIG-FIN-0002', false); put('ORIG-FIN-0002', false);
    put('ORIG-FIN-0003', true); put('ORIG-FIN-0003', true);
    const stats = computeStats({ nodes, metas, cards, now: NOW });
    const fin = stats.get('finance')!;
    expect(fin.answered).toBe(2);
    expect(fin.total).toBe(metas.filter((m) => m.subject === 'finance').length);
    expect(fin.mastery!).toBeGreaterThan(0.3);
    expect(fin.progress).toBeLessThan(fin.mastery!);
    const weak = weakest(stats, metas);
    expect(nodes.find((n) => n.id === weak[0].id)!.name).toBe('デュレーション');
  });
});

describe('session builder', () => {
  const ctxOf = (cards = new Map<string, Card>()) => {
    const { metas, nodes, nodeMap } = sample();
    const active = metas.filter((m) => m.lawFlag !== 'outdated');
    const stats = computeStats({ nodes, metas: active, cards, now: NOW });
    return { metas: active, cards, stats, nodes: nodeMap, now: NOW, examDate: new Date(2027, 5, 13).getTime(), rand: rng(1) };
  };

  it('時間 → 問題数', () => {
    expect(countForMinutes(5, 60)).toBe(5);
    expect(countForMinutes(20, 60)).toBe(20);
    expect(countForMinutes(40, 60)).toBe(40);
  });

  it('初回は全部新規で、同じ問題を重複させず、課目が連続しにくい', () => {
    const plan = buildSession(ctxOf(), { mode: 'daily', count: 12 });
    const ids = plan.items.map((i) => i.questionId);
    expect(ids.length).toBe(12);
    expect(new Set(ids).size).toBe(12);
    expect(plan.items.every((i) => i.slot === 'DISCOVERY' || i.slot === 'SURPRISE' || i.slot === 'CORE')).toBe(true);
    const metas = new Map(ctxOf().metas.map((m) => [m.id, m]));
    let repeats = 0;
    for (let i = 1; i < ids.length; i++) if (metas.get(ids[i])!.subject === metas.get(ids[i - 1])!.subject) repeats++;
    expect(repeats).toBeLessThanOrEqual(2);
    expect(plan.items.every((i) => i.reason.length > 0)).toBe(true);
  });

  it('復習期限の問題が CORE として先頭に来て、理由が付く', () => {
    const s = new LadderScheduler();
    const cards = new Map<string, Card>();
    const past = NOW - 3 * DAY;
    cards.set('ORIG-TAX-0002', s.review(emptyCard('ORIG-TAX-0002'), { correct: false, at: past, timeMs: 20_000, difficulty: 1, avgTimeMs: AVG }));
    const plan = buildSession(ctxOf(cards), { mode: 'daily', count: 10 });
    expect(plan.items[0].questionId).toBe('ORIG-TAX-0002');
    expect(plan.items[0].slot).toBe('CORE');
    expect(plan.items[0].reason).toBe('3日前に間違えた問題です');
    expect(plan.counts.CORE + plan.counts.CHALLENGE + plan.counts.DISCOVERY + plan.counts.SURPRISE).toBe(10);
  });

  it('範囲指定（課目別）と旧制度の除外', () => {
    const plan = buildSession(ctxOf(), { mode: 'subject', count: 50, scopeNodeId: 'finance' });
    expect(plan.items.length).toBe(6); // 旧制度1問は除外（類題含め6問）
    expect(plan.items.some((i) => i.questionId === 'ORIG-FIN-OLD-0001')).toBe(false);
  });

  it('Surprise 5 / Challenge 5 / 模試 / 実力診断', () => {
    expect(buildSession(ctxOf(), { mode: 'surprise', count: 5 }).items.length).toBe(5);
    const ch = buildSession(ctxOf(), { mode: 'challenge', count: 5 });
    expect(ch.items.length).toBe(5);
    expect(ch.items.every((i) => i.slot === 'CHALLENGE')).toBe(true);
    const mock = buildSession(ctxOf(), { mode: 'mock', count: 50, scopeNodeId: 'inheritance' });
    expect(mock.items.length).toBe(5);
    const diag = buildSession(ctxOf(), { mode: 'diagnostic', count: 12 });
    const metas = new Map(ctxOf().metas.map((m) => [m.id, m]));
    const subjects = new Set(diag.items.map((i) => metas.get(i.questionId)!.subject));
    expect(subjects.size).toBe(6);
  });
});

describe('adaptive & insights', () => {
  it('誤答 → 同論点（なければ上位分類）の別問題を2問後に差し込む → 正解 → 難しめ', () => {
    const { metas, nodeMap } = sample();
    const mm = new Map(metas.map((m) => [m.id, m]));
    const session: Session = {
      id: 's', mode: 'daily', label: '', startedAt: NOW, cursor: 0, feedback: 'immediate', answers: {}, inserted: 0,
      items: ['ORIG-FIN-0001', 'ORIG-TAX-0001', 'ORIG-RE-0001', 'ORIG-LIFE-0001'].map((id) => ({ questionId: id, slot: 'DISCOVERY', track: 'EXPLORE', reason: '' })),
    };
    const f1 = followUp(session, session.items[0], false, mm, new Map(), nodeMap, NOW)!;
    expect(f1.questionId).toBe('ORIG-FIN-0001-V1');
    expect(f1.followStage).toBe(1);
    const s2 = insertFollowUp(session, f1);
    expect(s2.items[3].questionId).toBe('ORIG-FIN-0001-V1');
    const f2 = followUp({ ...s2, cursor: 3 }, s2.items[3], true, mm, new Map(), nodeMap, NOW);
    // 同論点に別問題が無いので上位分類（金利と利回り）でも探すが、無ければ null
    expect(f2 === null || f2.followStage === 2).toBe(true);
    expect(followUp(session, session.items[0], true, mm, new Map(), nodeMap, NOW)).toBeNull();
  });

  it('「以前N回間違えた問題を初めて正解」', () => {
    const before = { ...emptyCard('q'), wrongCount: 3, correctCount: 0, lastResult: false };
    expect(answerInsight(before, true, 10_000)).toBe('以前3回間違えた問題を、今日は初めて正解しました');
    expect(answerInsight(before, false, 10_000)).toBeNull();
  });

  it('今週の成長: 7日前→今の比較', () => {
    const { metas, nodes } = sample();
    const s = new LadderScheduler();
    const attempts = [
      { q: 'ORIG-FIN-0002', ok: false, at: NOW - 10 * DAY },
      { q: 'ORIG-FIN-0002', ok: true, at: NOW - 2 * DAY },
      { q: 'ORIG-FIN-0002', ok: true, at: NOW - 1 * DAY },
    ].map((a, i) => ({ id: i, questionId: a.q, sessionId: 's', answeredAt: a.at, selected: null, correct: a.ok, timeMs: 20_000, mode: 'daily' as const, streakBefore: 0, wrongCountBefore: 0, dueAtBefore: null, difficulty: 3, subject: 'finance' as const, topicId: metas.find((m) => m.id === a.q)!.topicId, questionType: 'knowledge' as const }));
    const cards = replayCards(attempts, NOW, AVG);
    const g = growth({ nodes, metas, attempts, cards, now: NOW, avgTimeMs: AVG });
    expect(g.items.length).toBeGreaterThan(0);
    expect(g.items[0].after).toBeGreaterThan(g.items[0].before);
    expect(g.weakAfter).toBeLessThan(g.weakBefore);
    void s;
  });
});
