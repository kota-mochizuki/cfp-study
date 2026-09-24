// 手元の過去問変換データ（リポジトリ外・私的利用）で取り込みを検証する。ファイルが無ければスキップ。
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { bootstrap } from '../data/bootstrap';
import { commitImport, parseFile, previewImport } from '../data/importer';
import { loadCore } from '../data/repo';
import { computeStats } from '../engine/mastery';
import { buildSession } from '../engine/sessionBuilder';

const FILE = `${homedir()}/Downloads/CFP関係/import/past_exams_all.json`;

describe.skipIf(!existsSync(FILE))('公式過去問の取り込み（ローカルのみ）', () => {
  it('600問がエラーなく入り、課目別50問の模試が組める', async () => {
    await db.delete(); await db.open();
    await bootstrap();
    const { rows, caseGroups, parseErrors } = parseFile(readFileSync(FILE, 'utf8'), 'past_exams_all.json');
    expect(parseErrors).toEqual([]);
    const p = await previewImport(rows, caseGroups, '2026-10-01');
    const errs = p.results.filter((r) => r.errors.length).map((r) => `${r.row}: ${r.errors.join('/')}`);
    expect(errs).toEqual([]);
    expect(p.ok).toBe(600);
    expect(await commitImport(p, 'skip')).toBe(600);
    const core = await loadCore();
    const past = core.metas.filter((m) => m.source === 'official_past_exam');
    expect(past.length).toBe(600);
    const nodes = new Map(core.nodes.map((n) => [n.id, n]));
    const stats = computeStats({ nodes: core.nodes, metas: core.metas, cards: core.cards, now: Date.now() });
    const ctx = { metas: core.metas, cards: core.cards, stats, nodes, now: Date.now(), examDate: null };
    for (const s of ['finance', 'realestate', 'life', 'risk', 'tax', 'inheritance']) {
      expect(buildSession(ctx, { mode: 'mock', count: 50, scopeNodeId: s }).items.length).toBe(50);
    }
    expect(buildSession(ctx, { mode: 'daily', count: 20 }).items.length).toBe(20);
    const withImg = (await db.questions.toArray()).filter((q) => q.images?.length).length;
    expect(withImg).toBeGreaterThan(50);
    expect((await db.caseGroups.toArray()).length).toBe(99); // 過去問の事例98＋サンプル1
  }, 120_000);
});
