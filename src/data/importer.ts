import Papa from 'papaparse';
import type { CaseGroup, Question, TaxNode } from '../domain/types';
import { db } from './db';
import { TaxonomyIndex, toMeta } from './taxonomy';
import { ALL_COLUMNS, type RawRow, type RowResult, validateRow } from './validate';

export interface ImportPreview {
  results: RowResult[];
  newNodes: TaxNode[];
  caseGroups: CaseGroup[];
  ok: number;
  errors: number;
  warnings: number;
  existing: number;
  patches: number;
}

/** CSV（ヘッダー行必須・UTF-8）または JSON（配列 / {questions, case_groups}）を行データにする */
export function parseFile(text: string, filename: string): { rows: RawRow[]; caseGroups: CaseGroup[]; parseErrors: string[] } {
  const clean = text.replace(/^﻿/, '');
  if (/\.json$/i.test(filename) || /^\s*[[{]/.test(clean)) {
    try {
      const data = JSON.parse(clean);
      const rows = Array.isArray(data) ? data : data.questions;
      if (!Array.isArray(rows)) return { rows: [], caseGroups: [], parseErrors: ['JSON は配列、または { "questions": [...] } 形式にしてください'] };
      return { rows, caseGroups: Array.isArray(data.case_groups) ? data.case_groups : [], parseErrors: [] };
    } catch (e) {
      return { rows: [], caseGroups: [], parseErrors: [`JSON の構文エラー: ${(e as Error).message}`] };
    }
  }
  const res = Papa.parse<RawRow>(clean, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const parseErrors = res.errors.slice(0, 20).map((e) => `CSV ${e.row != null ? `${e.row + 2}行目` : ''}: ${e.message}`);
  const unknown = (res.meta.fields ?? []).filter((f) => !(ALL_COLUMNS as readonly string[]).includes(f));
  if (unknown.length) parseErrors.push(`未知の列は無視します: ${unknown.join(', ')}`);
  return { rows: res.data, caseGroups: [], parseErrors };
}

export async function previewImport(rows: RawRow[], extraCaseGroups: CaseGroup[], lawBaseDate: string): Promise<ImportPreview> {
  const [nodes, ids] = await Promise.all([db.nodes.toArray(), db.qmeta.toCollection().primaryKeys()]);
  const existingIds = new Set(ids);
  const patchIds = rows.filter(isPatchRow).map((r) => String(r.question_id)).filter((id) => existingIds.has(id));
  const existing = new Map((await db.questions.bulkGet(patchIds)).filter((q): q is Question => !!q).map((q) => [q.question_id, q]));
  return validateRows(rows, extraCaseGroups, nodes, existingIds, lawBaseDate, existing);
}

/** question_id と一部の項目だけの行 = 既存問題への差分（解説の追加など） */
export const isPatchRow = (r: RawRow) => !!r.question_id && !String(r.question_text ?? '').trim();

/** 既存の問題を行データに戻す（差分行とマージするため） */
export function questionToRaw(q: Question): RawRow {
  return { ...q } as unknown as RawRow;
}

export function validateRows(rows: RawRow[], extraCaseGroups: CaseGroup[], nodes: TaxNode[], existingIds: Set<string>, lawBaseDate: string, existing: Map<string, Question> = new Map()): ImportPreview {
  const taxonomy = new TaxonomyIndex(nodes);
  const seen = new Set<string>();
  // CSV は1行目がヘッダーなので、データ行はファイル上 2 行目から。差分行は既存の問題に重ねて検証する
  const results = rows.map((r, i) => {
    const base = isPatchRow(r) ? existing.get(String(r.question_id)) : undefined;
    const merged = base ? { ...questionToRaw(base), ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v != null)) } : r;
    const res = validateRow(merged, i + 2, { taxonomy, existingIds, lawBaseDate }, seen);
    if (base && res.question) res.question = { ...res.question, topic_id: base.topic_id, images: res.question.images ?? base.images, created_at: base.created_at };
    if (base) res.patch = true;
    return res;
  });
  const groups = new Map(extraCaseGroups.map((g) => [g.id, g]));
  for (const r of results) if (r.caseGroup) groups.set(r.caseGroup.id, r.caseGroup);
  return {
    results,
    newNodes: taxonomy.created,
    caseGroups: [...groups.values()],
    ok: results.filter((r) => r.question).length,
    errors: results.filter((r) => r.errors.length).length,
    warnings: results.filter((r) => r.warnings.length && !r.errors.length).length,
    existing: results.filter((r) => r.question && r.exists && !r.patch).length,
    patches: results.filter((r) => r.question && r.patch).length,
  };
}

/** 検証済みの行を投入。500件ずつのチャンクで 1万件規模にも対応 */
export async function commitImport(p: ImportPreview, onExisting: 'overwrite' | 'skip', onProgress?: (done: number, total: number) => void): Promise<number> {
  const qs: Question[] = p.results.filter((r) => r.question && (!r.exists || r.patch || onExisting === 'overwrite')).map((r) => r.question!);
  const usedNodeIds = new Set(qs.map((q) => q.topic_id));
  // 使われる新規ノードとその祖先だけを登録
  const byId = new Map(p.newNodes.map((n) => [n.id, n]));
  const needed = new Set<string>();
  for (const id of usedNodeIds) {
    let cur = byId.get(id);
    while (cur && !needed.has(cur.id)) { needed.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
  }
  if (needed.size) await db.nodes.bulkPut(p.newNodes.filter((n) => needed.has(n.id)));
  if (p.caseGroups.length) await db.caseGroups.bulkPut(p.caseGroups);
  if (onExisting === 'overwrite') {
    const old = await db.questions.bulkGet(qs.map((q) => q.question_id));
    old.forEach((o, i) => { if (o) qs[i] = { ...qs[i], created_at: o.created_at }; });
  }
  const CHUNK = 500;
  for (let i = 0; i < qs.length; i += CHUNK) {
    const chunk = qs.slice(i, i + CHUNK);
    await db.transaction('rw', db.questions, db.qmeta, async () => {
      await db.questions.bulkPut(chunk);
      await db.qmeta.bulkPut(chunk.map(toMeta));
    });
    onProgress?.(Math.min(qs.length, i + CHUNK), qs.length);
  }
  return qs.length;
}

export function csvTemplate(): string {
  return Papa.unparse({ fields: [...ALL_COLUMNS], data: [] });
}

export function toCsv(qs: Question[]): string {
  return Papa.unparse(qs.map((q) => ({
    ...q,
    correct_answer: q.correct_answer,
    related_topics: q.related_topics.join(';'),
    images: undefined,
    tags: q.tags.join(';'),
  })), { columns: ALL_COLUMNS.filter((c) => !['case_title', 'case_text'].includes(c)) as string[] });
}
