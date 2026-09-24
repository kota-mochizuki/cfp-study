import { db } from './db';
import { commitImport, validateRows } from './importer';
import { DEFAULT_SETTINGS } from './repo';
import { SAMPLE_CASE_GROUPS, SAMPLE_QUESTIONS } from './seed/sampleQuestions';
import { seedNodes } from './taxonomy';
import type { CaseGroup } from '../domain/types';

/** 初期データのバージョン。論点マスタを更新したら上げる（既存ノードは上書きしない） */
const SEED_VERSION = 1;

export async function bootstrap(): Promise<void> {
  const v = (await db.kv.get('seedVersion'))?.value as number | undefined;
  if (v && v >= SEED_VERSION) return;
  const existing = new Set(await db.nodes.toCollection().primaryKeys());
  await db.nodes.bulkPut(seedNodes().filter((n) => !existing.has(n.id)));
  if (!v) {
    const nodes = await db.nodes.toArray();
    const preview = validateRows(SAMPLE_QUESTIONS, SAMPLE_CASE_GROUPS as CaseGroup[], nodes, new Set(), DEFAULT_SETTINGS.lawBaseDate);
    await commitImport(preview, 'skip');
  }
  await db.kv.put({ key: 'seedVersion', value: SEED_VERSION });
}
