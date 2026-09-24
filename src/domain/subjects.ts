import type { ChoiceKey, ErrorCause, LawFlag, QuestionType, SessionMode, SourceType, SubjectId } from './types';

export interface SubjectDef {
  id: SubjectId;
  no: number;
  name: string;
  short: string;
  /** 試験日程上の日（1日目/2日目） */
  day: 1 | 2;
}

/** CFP 6課目（最上位カテゴリ・固定） */
export const SUBJECTS: SubjectDef[] = [
  { id: 'finance', no: 1, name: '金融資産運用設計', short: '金融', day: 1 },
  { id: 'realestate', no: 2, name: '不動産運用設計', short: '不動産', day: 1 },
  { id: 'life', no: 3, name: 'ライフプランニング・リタイアメントプランニング', short: 'ライフ', day: 1 },
  { id: 'risk', no: 4, name: 'リスクと保険', short: 'リスク', day: 2 },
  { id: 'tax', no: 5, name: 'タックスプランニング', short: 'タックス', day: 2 },
  { id: 'inheritance', no: 6, name: '相続・事業承継設計', short: '相続', day: 2 },
];

export const SUBJECT_MAP = Object.fromEntries(SUBJECTS.map((s) => [s.id, s])) as Record<SubjectId, SubjectDef>;

/** インポート時に日本語課目名・略称・番号も受け付ける */
export function parseSubject(v: string): SubjectId | null {
  const s = v.trim();
  for (const d of SUBJECTS) {
    if (s === d.id || s === d.name || s === d.short || s === String(d.no)) return d.id;
  }
  const alias: Record<string, SubjectId> = {
    '金融資産運用': 'finance', '不動産運用': 'realestate', 'ライフプランニング': 'life',
    'リスク': 'risk', '保険': 'risk', 'タックス': 'tax', '相続・事業承継': 'inheritance', '相続': 'inheritance',
  };
  return alias[s] ?? null;
}

export const CHOICE_KEYS: ChoiceKey[] = ['A', 'B', 'C', 'D'];
/** 本番と同じ 1〜4 表記 */
export const choiceLabel = (k: ChoiceKey) => String(CHOICE_KEYS.indexOf(k) + 1);

export const QUESTION_TYPES: Record<QuestionType, string> = {
  knowledge: '知識', calculation: '計算', case: '事例', reading: '資料読解',
};
export const SOURCE_TYPES: Record<SourceType, string> = {
  official_past_exam: '過去問', original: 'オリジナル', ai_variant: 'AI類題',
};
export const LAW_FLAGS: Record<LawFlag, string> = {
  verified: '法改正確認済み', needs_check: '要確認', outdated: '旧制度問題',
};
export const ERROR_CAUSES: Record<ErrorCause, string> = {
  knowledge: '知識不足', calc: '計算ミス', misread: '読み間違い', law: '法改正', forgot: '忘れていた', time: '時間不足',
};
export const LEVEL_LABELS = ['未回答', '苦手', '学習中', '定着途中', '定着'] as const;

export const MODE_LABELS: Record<SessionMode, string> = {
  daily: '今日の最適学習', subject: '科目別', weak: '苦手攻略', wrong: '間違えた問題', unanswered: '未回答',
  random: 'ランダム', test10: '10問テスト', mock: '本番模試', surprise: 'Surprise 5', challenge: 'Challenge 5',
  calc: '計算特訓', diagnostic: '実力診断', favorites: 'お気に入り', flagged: 'あとで復習', single: '1問',
};
