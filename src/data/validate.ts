import type { CaseGroup, ChoiceKey, LawFlag, Question, QuestionStatus, QuestionType, SourceType, VerificationStatus } from '../domain/types';
import { parseSubject } from '../domain/subjects';
import { deriveVerification } from './quality';
import type { TaxonomyIndex } from './taxonomy';

export type RawRow = Record<string, unknown>;

export interface RowResult {
  row: number;
  question?: Question;
  caseGroup?: CaseGroup;
  errors: string[];
  warnings: string[];
  /** DB に同じ question_id が既にある */
  exists?: boolean;
  /** 既存問題への差分（解説追加など）。スキップ設定に関係なく反映する */
  patch?: boolean;
}

export const REQUIRED = [
  'question_id', 'subject', 'question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d',
  'correct_answer', 'explanation', 'law_reference_date',
] as const;

export const ALL_COLUMNS = [
  'question_id', 'subject', 'category_large', 'category_middle', 'category_small', 'topic', 'question_text',
  'case_group_id', 'case_title', 'case_text',
  'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct_answer',
  'explanation', 'explanation_a', 'explanation_b', 'explanation_c', 'explanation_d', 'key_point', 'related_topics',
  'difficulty', 'importance', 'frequency', 'question_type', 'source_type', 'source_year', 'source_exam',
  'source_question_number', 'parent_question_id', 'calc_method', 'variant_spec',
  'law_reference_date', 'law_revision_flag', 'tags', 'status',
  'explanation_short', 'trap', 'calculation_steps', 'verified_answer', 'verification_status', 'current_rule_note',
] as const;

/** 仕様書側の名前で書かれた列も受け付ける（既存項目に統合） */
export const COLUMN_ALIASES: Record<string, string> = {
  official_answer: 'correct_answer',
  explanation_detailed: 'explanation',
  law_revision_status: 'law_revision_flag',
};

export function applyAliases(raw: RawRow): RawRow {
  const out: RawRow = { ...raw };
  for (const [from, to] of Object.entries(COLUMN_ALIASES)) if (out[from] != null && out[from] !== '' && (out[to] == null || out[to] === '')) out[to] = out[from];
  return out;
}

/** 計算過程: 配列、または改行・「;」区切り */
export function parseSteps(v: unknown): string[] | undefined {
  const xs = Array.isArray(v) ? v.map(str) : str(v).split(/\n|;|；/).map((s) => s.trim());
  const steps = xs.filter(Boolean);
  return steps.length ? steps : undefined;
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

export function parseAnswer(v: string): ChoiceKey | null {
  const s = v.normalize('NFKC').trim().toUpperCase();
  const map: Record<string, ChoiceKey> = { A: 'A', B: 'B', C: 'C', D: 'D', '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
  return map[s] ?? null;
}

export function parseDate(v: string): string | null {
  const m = v.normalize('NFKC').trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** JSON インポートの images（data:image/... の配列）。CSV では使わない */
export function parseImages(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const xs = v.filter((x): x is string => typeof x === 'string' && x.startsWith('data:image/'));
  return xs.length ? xs : undefined;
}

export function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  return str(v).split(/[;；、|]/).map((s) => s.trim()).filter(Boolean);
}

function parseIntIn(v: unknown, min: number, max: number): number | null {
  const s = str(v).normalize('NFKC');
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

const QTYPES: Record<string, QuestionType> = { knowledge: 'knowledge', calculation: 'calculation', case: 'case', reading: 'reading', 知識: 'knowledge', 計算: 'calculation', 事例: 'case', 資料読解: 'reading', 読解: 'reading' };
const STYPES: Record<string, SourceType> = { official_past_exam: 'official_past_exam', original: 'original', ai_variant: 'ai_variant', 過去問: 'official_past_exam', オリジナル: 'original', AI類題: 'ai_variant', 類題: 'ai_variant' };
const VSTATUS: Record<string, VerificationStatus> = { unverified: 'unverified', verified: 'verified', needs_review: 'needs_review', mismatch: 'mismatch', 未検証: 'unverified', 検証済み: 'verified', 要確認: 'needs_review', 不一致: 'mismatch' };
const LFLAGS: Record<string, LawFlag> = { verified: 'verified', needs_check: 'needs_check', outdated: 'outdated', needs_review: 'needs_check', old_rule: 'outdated', 法改正確認済み: 'verified', 確認済み: 'verified', 要確認: 'needs_check', 旧制度問題: 'outdated', 旧制度: 'outdated' };
const STATUSES: Record<string, QuestionStatus> = { active: 'active', draft: 'draft', archived: 'archived', 公開: 'active', 下書き: 'draft', アーカイブ: 'archived' };

export interface ValidateContext {
  taxonomy: TaxonomyIndex;
  existingIds: Set<string>;
  lawBaseDate: string;
  now?: string;
}

/**
 * 1行を検証して Question に正規化する。
 * エラー: 取り込めない（必須欠落・正解番号不正・選択肢不足/重複・法令基準日不足/不正・課目不明）
 * 警告: 取り込めるが確認推奨（解説不足・既定値補完・過去問の出典不足・基準日が古い）
 */
export function validateRow(raw: RawRow, row: number, ctx: ValidateContext, seenIds: Set<string>): RowResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  raw = applyAliases(raw);
  const g = (k: string) => str(raw[k]);

  for (const k of REQUIRED) if (!g(k)) errors.push(`必須項目「${k}」がありません`);

  const id = g('question_id');
  if (id && seenIds.has(id)) errors.push(`question_id「${id}」がファイル内で重複しています`);
  if (id) seenIds.add(id);

  const subject = g('subject') ? parseSubject(g('subject')) : null;
  if (g('subject') && !subject) errors.push(`課目「${g('subject')}」を認識できません（finance/realestate/life/risk/tax/inheritance または日本語課目名）`);

  const correct = g('correct_answer') ? parseAnswer(g('correct_answer')) : null;
  const verified = g('verified_answer') ? parseAnswer(g('verified_answer')) : undefined;
  if (g('verified_answer') && !verified) errors.push(`verified_answer「${g('verified_answer')}」が不正です（A〜D または 1〜4）`);
  const vstated = g('verification_status') ? VSTATUS[g('verification_status')] : undefined;
  if (g('verification_status') && !vstated) warnings.push(`verification_status「${g('verification_status')}」不明 → 自動判定`);
  if (correct && verified && verified !== correct) warnings.push(`公式解答 ${correct} と検証結果 ${verified} が一致しません（要確認として取り込みます）`);
  if (g('correct_answer') && !correct) errors.push(`正解「${g('correct_answer')}」が不正です（A〜D または 1〜4）`);

  const choices = ['choice_a', 'choice_b', 'choice_c', 'choice_d'].map(g);
  const filled = choices.filter(Boolean);
  if (filled.length > 0 && filled.length < 4) errors.push(`選択肢が不足しています（${filled.length}/4）`);
  if (new Set(filled.map((c) => c.normalize('NFKC'))).size < filled.length) errors.push('同じ内容の選択肢があります');

  const lawDate = g('law_reference_date') ? parseDate(g('law_reference_date')) : null;
  if (g('law_reference_date') && !lawDate) errors.push(`法令基準日「${g('law_reference_date')}」が日付として不正です（YYYY-MM-DD）`);

  let difficulty = parseIntIn(raw.difficulty, 1, 5);
  if (Number.isNaN(difficulty)) { warnings.push('difficulty は1〜5。既定値3にしました'); difficulty = 3; }
  let importance = parseIntIn(raw.importance, 1, 3);
  if (Number.isNaN(importance)) { warnings.push('importance は1〜3。既定値2にしました'); importance = 2; }
  let frequency = parseIntIn(raw.frequency, 1, 3);
  if (Number.isNaN(frequency)) { warnings.push('frequency は1〜3。既定値2にしました'); frequency = 2; }

  const qtype = g('question_type') ? QTYPES[g('question_type')] : 'knowledge';
  if (!qtype) warnings.push(`question_type「${g('question_type')}」不明 → knowledge`);
  const stype = g('source_type') ? STYPES[g('source_type')] : 'original';
  if (!stype) warnings.push(`source_type「${g('source_type')}」不明 → original`);
  const lflag = g('law_revision_flag') ? LFLAGS[g('law_revision_flag')] : 'needs_check';
  if (!lflag) warnings.push(`law_revision_flag「${g('law_revision_flag')}」不明 → needs_check`);
  if (!g('law_revision_flag')) warnings.push('法改正確認状況が未指定のため「要確認」にしました');
  const status = g('status') ? STATUSES[g('status')] ?? 'active' : 'active';

  const topic = g('topic') || g('category_small') || g('category_middle') || g('category_large');
  if (!g('topic')) warnings.push(topic ? `topic 未指定のため「${topic}」を論点としました` : 'topic・分類が未指定のため課目直下に置きます');
  if (!g('key_point')) warnings.push('key_point（この問題のポイント）がありません');
  const missingEx = ['a', 'b', 'c', 'd'].filter((k) => !g(`explanation_${k}`));
  if (missingEx.length) warnings.push(`選択肢別解説がありません（${missingEx.map((k) => k.toUpperCase()).join(',')}）`);

  const year = parseIntIn(raw.source_year, 1990, 2100);
  const exam = parseIntIn(raw.source_exam, 1, 3);
  const qno = parseIntIn(raw.source_question_number, 1, 200);
  if ((stype ?? 'original') === 'official_past_exam' && (!year || !exam || !qno))
    warnings.push('過去問は source_year / source_exam / source_question_number の入力を推奨します');
  if (lawDate && lflag === 'verified' && lawDate < ctx.lawBaseDate)
    warnings.push(`法令基準日 ${lawDate} が設定の基準日 ${ctx.lawBaseDate} より古いのに「確認済み」です`);

  const result: RowResult = { row, errors, warnings, exists: !!id && ctx.existingIds.has(id) };
  if (errors.length || !subject || !correct || !lawDate) return result;

  const now = ctx.now ?? new Date().toISOString();
  const topicId = ctx.taxonomy.resolve(subject, g('category_large'), g('category_middle'), g('category_small'), topic);
  const caseId = g('case_group_id') || undefined;
  if (caseId && g('case_text')) {
    result.caseGroup = { id: caseId, subject, title: g('case_title') || caseId, case_text: g('case_text') };
  }
  result.question = {
    question_id: id, subject,
    category_large: g('category_large') || undefined, category_middle: g('category_middle') || undefined,
    category_small: g('category_small') || undefined, topic: topic || '', topic_id: topicId,
    question_text: g('question_text'), case_group_id: caseId,
    choice_a: choices[0], choice_b: choices[1], choice_c: choices[2], choice_d: choices[3], correct_answer: correct,
    explanation: g('explanation'),
    explanation_short: g('explanation_short') || undefined, trap: g('trap') || undefined,
    calculation_steps: parseSteps(raw.calculation_steps), current_rule_note: g('current_rule_note') || undefined,
    verified_answer: verified ?? undefined, verification_status: deriveVerification(correct, verified ?? undefined, vstated),
    explanation_a: g('explanation_a') || undefined, explanation_b: g('explanation_b') || undefined,
    explanation_c: g('explanation_c') || undefined, explanation_d: g('explanation_d') || undefined,
    key_point: g('key_point'), related_topics: parseList(raw.related_topics),
    difficulty: difficulty ?? 3, importance: importance ?? 2, frequency: frequency ?? 2,
    question_type: qtype ?? 'knowledge', source_type: stype ?? 'original',
    source_year: year || undefined, source_exam: exam || undefined, source_question_number: qno || undefined,
    parent_question_id: g('parent_question_id') || undefined, calc_method: g('calc_method') || undefined,
    variant_spec: g('variant_spec') || undefined,
    law_reference_date: lawDate, law_revision_flag: lflag ?? 'needs_check', tags: parseList(raw.tags), status,
    images: parseImages(raw.images),
    created_at: g('created_at') || now, updated_at: now,
  };
  return result;
}

/** 法改正の警告を表示すべきか */
export function lawWarning(q: Pick<Question, 'law_revision_flag' | 'law_reference_date'>, lawBaseDate: string): string | null {
  if (q.law_revision_flag === 'outdated') return '旧制度の問題です。現在の法令では内容が異なる可能性があります';
  if (q.law_revision_flag === 'needs_check' && q.law_reference_date < lawBaseDate)
    return `法令基準日 ${q.law_reference_date} 時点の問題です。現在の法令では内容が異なる可能性があります`;
  return null;
}
