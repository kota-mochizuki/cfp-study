import { db } from './db';
import { commitImport, validateRows } from './importer';
import { DEFAULT_SETTINGS } from './repo';
import { SAMPLE_CASE_GROUPS, SAMPLE_QUESTIONS } from './seed/sampleQuestions';
import { seedNodes } from './taxonomy';
import type { CaseGroup } from '../domain/types';

/** 初期データのバージョン。論点マスタを更新したら上げる（既存ノードは上書きしない） */
const SEED_VERSION = 2;

export async function bootstrap(): Promise<void> {
  const v = (await db.kv.get('seedVersion'))?.value as number | undefined;
  if (v && v >= SEED_VERSION) return;
  const existing = new Set(await db.nodes.toCollection().primaryKeys());
  await db.nodes.bulkPut(seedNodes().filter((n) => !existing.has(n.id)));
  const nodes = await db.nodes.toArray();
  if (!v) {
    const preview = validateRows(SAMPLE_QUESTIONS, SAMPLE_CASE_GROUPS as CaseGroup[], nodes, new Set(), DEFAULT_SETTINGS.lawBaseDate);
    await commitImport(preview, 'skip');
  } else if (v < 2) {
    // v2: サンプル問題の解説を品質基準対応版に更新（端末に残っているものだけ。削除済みは戻さない）
    const present = new Set((await db.questions.bulkGet(SAMPLE_QUESTIONS.map((r) => String(r.question_id)))).filter(Boolean).map((q) => q!.question_id));
    const rows = SAMPLE_QUESTIONS.filter((r) => present.has(String(r.question_id)));
    if (rows.length) await commitImport(validateRows(rows, [], nodes, present, DEFAULT_SETTINGS.lawBaseDate), 'overwrite');
  }
  await db.kv.put({ key: 'seedVersion', value: SEED_VERSION });
}
