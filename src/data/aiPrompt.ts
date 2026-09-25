import type { CaseGroup, Question } from '../domain/types';
import { SUBJECT_MAP } from '../domain/subjects';

/**
 * AI解説生成用のプロンプト。
 * アプリに APIキーを置かない（公開PWAのため）。書き出したプロンプトを Claude 等に渡し、
 * 返ってきた JSON をインポート画面から「差分」として取り込む。
 */
export const AI_RULES = `あなたはCFP資格審査試験の解説者です。以下の手順と基準を厳守して、各問題の解説をJSONで出力してください。

## 検証手順（順番を守る）
1. 問題文と事例を読み、問われていることを確定する
2. 選択肢1〜4を1つずつ、制度・法令・計算に照らして独立に ○/× 判定する
3. 公式解答を見ずに、自分の解答（verified_answer）を決める
4. 最後に公式解答（official_answer）と照合する
   - 一致 → verification_status: "verified"
   - 不一致 → verification_status: "mismatch"。公式解答に合わせた理由の後付けは禁止。自分の判定根拠をそのまま書き、どこが食い違うかを explanation に明記する
   - 法令基準日時点の制度が確認できない・判断に自信がない → "needs_review"

## 解説の基準
- 不正解の選択肢は必ず「どこが誤りか」＋「正しくはどうなるか」を書く（例: 「○○」が誤り。正しくは△△）
- 正解の選択肢は「なぜ正しいか」を根拠（規定・計算）とともに書く
- explanation_short: 回答直後に出す一言（40字以内）
- key_point: 試験で覚えるべき要点を1〜3個（改行区切り、各30字程度）
- trap: ひっかけがある場合のみ（例: 「契約者」と「被保険者」の入れ替え）。無ければ空文字
- calculation_steps: 計算問題のみ。["STEP1 何を求めるか","STEP2 使用する数値","STEP3 計算式","STEP4 計算","STEP5 選択肢との照合"] の5要素
- 法令基準日（law_reference_date）時点の制度で判断する。現在の制度と異なる場合は current_rule_note に現行制度を書く
- 選択肢の番号は 1〜4 で書く

## 出力形式（JSONのみ。前後に文章を付けない）
{"questions":[{
 "question_id":"…",
 "verified_answer":"1〜4",
 "verification_status":"verified|mismatch|needs_review",
 "explanation_short":"…",
 "explanation":"詳細解説（検証の要約。mismatch の場合は食い違いの内容）",
 "explanation_a":"選択肢1の○×と理由", "explanation_b":"…", "explanation_c":"…", "explanation_d":"…",
 "key_point":"…\\n…",
 "trap":"",
 "calculation_steps":[],
 "current_rule_note":"",
 "difficulty":1〜5,
 "question_type":"knowledge|calculation|case|reading"
}]}`;

const n = (k: string) => String('ABCD'.indexOf(k) + 1);

export function buildAiPrompt(qs: Question[], groups: Map<string, CaseGroup>): string {
  const body = qs.map((q) => {
    const g = q.case_group_id ? groups.get(q.case_group_id) : undefined;
    return [
      `### question_id: ${q.question_id}`,
      `課目: ${SUBJECT_MAP[q.subject].name} / 出典: ${q.source_year ? `${q.source_year}年度第${q.source_exam}回 問題${q.source_question_number}` : q.source_type} / 法令基準日: ${q.law_reference_date}`,
      g ? `【事例】\n${g.case_text}${g.images?.length ? '\n（※原本に図表あり。画像は別途参照）' : ''}` : '',
      `【問題】\n${q.question_text}${q.images?.length ? '\n（※原本に図表あり。画像は別途参照）' : ''}`,
      `1. ${q.choice_a}\n2. ${q.choice_b}\n3. ${q.choice_c}\n4. ${q.choice_d}`,
      `official_answer: ${n(q.correct_answer)}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');
  return `${AI_RULES}\n\n# 問題（${qs.length}問）\n\n${body}\n`;
}
