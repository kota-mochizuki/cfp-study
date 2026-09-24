// ドメイン型。問題スキーマはインポート形式（CSV/JSON）とそのまま対応させるため snake_case。

export type SubjectId = 'finance' | 'realestate' | 'life' | 'risk' | 'tax' | 'inheritance';
/** 内部表現は A〜D。画面表記は本番に合わせて 1〜4。 */
export type ChoiceKey = 'A' | 'B' | 'C' | 'D';
export type QuestionType = 'knowledge' | 'calculation' | 'case' | 'reading';
export type SourceType = 'official_past_exam' | 'original' | 'ai_variant';
/** verified=法改正確認済み / needs_check=要確認 / outdated=旧制度問題 */
export type LawFlag = 'verified' | 'needs_check' | 'outdated';
export type QuestionStatus = 'active' | 'draft' | 'archived';

export interface Question {
  question_id: string;
  subject: SubjectId;
  category_large?: string;
  category_middle?: string;
  category_small?: string;
  topic: string;
  /** 論点マスタ上のノードID（インポート時に解決） */
  topic_id: string;
  question_text: string;
  /** 共通事例（大問）への参照 */
  case_group_id?: string;
  choice_a: string;
  choice_b: string;
  choice_c: string;
  choice_d: string;
  correct_answer: ChoiceKey;
  explanation: string;
  explanation_a?: string;
  explanation_b?: string;
  explanation_c?: string;
  explanation_d?: string;
  key_point: string;
  related_topics: string[];
  /** 1(易)〜5(難) */
  difficulty: number;
  /** 試験での重要度 1〜3 */
  importance: number;
  /** 出題頻度 1〜3 */
  frequency: number;
  question_type: QuestionType;
  source_type: SourceType;
  source_year?: number;
  /** 第n回 */
  source_exam?: number;
  source_question_number?: number;
  /** 類題: 元問題 */
  parent_question_id?: string;
  /** 類題: 維持する計算方法の要約 */
  calc_method?: string;
  /** 類題: 変更可能なパラメータ（数値・人物・条件・問い方）の記述 */
  variant_spec?: string;
  law_reference_date: string; // YYYY-MM-DD
  law_revision_flag: LawFlag;
  tags: string[];
  /** 原本の資料・図表の画像（data URL）。表やグラフを文字にできない過去問用 */
  images?: string[];
  status: QuestionStatus;
  created_at: string;
  updated_at: string;
}

/** 出題エンジン用の軽量インデックス。起動時にこれだけ読む。 */
export interface QuestionMeta {
  id: string;
  subject: SubjectId;
  topicId: string;
  difficulty: number;
  importance: number;
  frequency: number;
  type: QuestionType;
  source: SourceType;
  year?: number;
  lawFlag: LawFlag;
  lawDate: string;
  status: QuestionStatus;
  caseGroupId?: string;
  textLength: number;
}

export interface CaseGroup {
  id: string;
  subject: SubjectId;
  title: string;
  case_text: string;
  /** 共通資料の画像（data URL） */
  images?: string[];
}

export type NodeLevel = 'subject' | 'large' | 'middle' | 'small' | 'topic';
export interface TaxNode {
  id: string;
  parentId: string | null;
  level: NodeLevel;
  name: string;
  order: number;
}

export type SessionMode =
  | 'daily' | 'subject' | 'weak' | 'wrong' | 'unanswered' | 'random' | 'test10' | 'mock'
  | 'surprise' | 'challenge' | 'calc' | 'diagnostic' | 'favorites' | 'flagged' | 'single';

/** 内部分類: CORE=復習・弱点 / CHALLENGE=少し難しい / DISCOVERY=新規論点 / SURPRISE=ランダム */
export type Slot = 'CORE' | 'CHALLENGE' | 'DISCOVERY' | 'SURPRISE';
/** MASTER=GRITで深める / EXPLORE=好奇心で広げる */
export type Track = 'MASTER' | 'EXPLORE';
export type ErrorCause = 'knowledge' | 'calc' | 'misread' | 'law' | 'forgot' | 'time';

export interface Attempt {
  id?: number;
  questionId: string;
  sessionId: string;
  answeredAt: number;
  selected: ChoiceKey | null;
  correct: boolean;
  timeMs: number;
  mode: SessionMode;
  slot?: Slot;
  track?: Track;
  reason?: string;
  /** 1=簡単 2=普通 3=難しい */
  selfRating?: 1 | 2 | 3;
  errorCause?: ErrorCause;
  explanationOpened?: boolean;
  streakBefore: number;
  wrongCountBefore: number;
  dueAtBefore: number | null;
  difficulty: number;
  subject: SubjectId;
  topicId: string;
  questionType: QuestionType;
}

/** 問題ごとの学習状態（SRS＋習熟度の増分集計） */
export interface Card {
  questionId: string;
  /** 0 未回答 / 1 苦手 / 2 学習中 / 3 定着途中 / 4 定着 */
  level: 0 | 1 | 2 | 3 | 4;
  streak: number;
  correctCount: number;
  wrongCount: number;
  lastAnsweredAt: number | null;
  lastResult: boolean | null;
  lastTimeMs: number | null;
  dueAt: number | null;
  intervalDays: number;
  /** あとで復習 */
  flagged: boolean;
  /** 時間減衰つき重み付き得点の累積（習熟度計算用） */
  wScore: number;
  wTotal: number;
  wAt: number | null;
}

export interface SessionItem {
  questionId: string;
  slot: Slot;
  track: Track;
  reason: string;
  /** Adaptive で差し込まれた問題 */
  followOf?: string;
  followStage?: 1 | 2;
}

export interface SessionAnswer {
  selected: ChoiceKey | null;
  correct: boolean;
  timeMs: number;
}

export interface Session {
  id: string;
  mode: SessionMode;
  label: string;
  startedAt: number;
  endedAt?: number;
  items: SessionItem[];
  cursor: number;
  /** immediate=1問ごとに解説 / deferred=最後にまとめて（10問テスト・模試） */
  feedback: 'immediate' | 'deferred';
  timeLimitMs?: number;
  timeBudgetMin?: number;
  subject?: SubjectId;
  answers: Record<string, SessionAnswer>;
  /** 模試の見直しフラグ */
  marked?: string[];
  inserted: number;
}

export interface Settings {
  examDate: string;
  lawBaseDate: string;
  passLineRatio: number;
  simpleHome: boolean;
  shuffleChoices: boolean;
  includeOutdated: boolean;
  theme: 'auto' | 'light' | 'dark';
  defaultMinutes: number;
  /** 秒/問（解説を読む時間込み）。セッション終了ごとに更新 */
  secPerQuestion: number;
  /** 実力診断で得た課目別の初期習熟度 */
  priors: Partial<Record<SubjectId, number>>;
  diagnosticDone: boolean;
  /** スケジューラ設定（差し替え可能） */
  intervals: number[];
}

export interface UxEvent {
  id?: number;
  type: 'mode_selected' | 'session_completed' | 'session_abandoned' | 'time_selected' | 'screen';
  at: number;
  payload: Record<string, unknown>;
}

export interface DevLog {
  id?: number;
  kind: 'dev' | 'content_work';
  minutes: number;
  note: string;
  at: number;
}

export interface Idea {
  id?: number;
  idea: string;
  purpose: string;
  contribution: string;
  effect: string;
  cost: string;
  createdAt: number;
  /** Feature Gate 評価（1〜3）。当日は未評価 */
  gate?: { a: number; b: number; c: number; d: number };
  status: 'parked' | 'approved' | 'rejected' | 'done';
}

export interface WeeklyReview {
  id?: number;
  at: number;
  weekAnswers: number;
  pain: string;
  unused: string;
  decision: string;
}
