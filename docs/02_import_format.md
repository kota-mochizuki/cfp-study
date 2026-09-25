# 問題データ インポート仕様（CSV / JSON）

設定 → 問題管理 → インポート から取り込みます。取り込む前に全行を検証し、エラー行は取り込みません。

## 形式
- **CSV**: UTF-8（BOM可）、1行目に列名。Excel で作る場合は「CSV UTF-8」で保存。テンプレートはインポート画面から取得できます。
- **JSON**: 問題の配列、または `{ "questions": [...], "case_groups": [...] }`。

## 列
| 列 | 必須 | 内容 |
|---|---|---|
| question_id | ✓ | 一意ID。推奨: `PAST-2026-1-05-012`（過去問）/ `ORIG-TAX-0010` / `ORIG-TAX-0010-V1`（類題） |
| subject | ✓ | `finance` `realestate` `life` `risk` `tax` `inheritance`、または日本語課目名・略称（金融/不動産/ライフ/リスク/タックス/相続）・番号1〜6 |
| category_large / middle / small | | FP学習ガイドの名称（空白・全半角の違いは無視）。無い名前は新しい論点ノードとして自動作成 |
| topic | | 論点（最下層）。省略時は最も深い分類名 |
| question_text | ✓ | Markdown（`**太字**`、`|表|`、`- 箇条書き`） |
| case_group_id / case_title / case_text | | 大問の共通事例。同じIDの問題で事例を共有。case_text は1行に書けばよい |
| choice_a〜choice_d | ✓ | 4つとも必須・重複不可。画面表記は 1〜4 |
| correct_answer | ✓ | `A`〜`D` または `1`〜`4` |
| explanation | ✓ | 総合解説 |
| explanation_a〜d | | 選択肢別の解説（無いと警告） |
| key_point | | 「この問題のポイント」1〜3行（無いと警告） |
| related_topics / tags | | `;` 区切り |
| difficulty | | 1〜5（既定3） |
| importance / frequency | | 1〜3（既定2）。出題の優先度に使う |
| question_type | | `knowledge` `calculation` `case` `reading`（知識/計算/事例/資料読解） |
| source_type | | `official_past_exam` `original` `ai_variant`（過去問/オリジナル/類題） |
| source_year / source_exam / source_question_number | | 年度・第n回・問題番号（過去問は入力推奨） |
| parent_question_id / calc_method / variant_spec | | 類題用：元問題・維持する計算方法・変更する条件 |
| law_reference_date | ✓ | 法令基準日 `YYYY-MM-DD`（`2027/1/1`、`2027年1月1日` も可） |
| law_revision_flag | | `verified` `needs_check` `outdated`（確認済み/要確認/旧制度問題）。省略時は要確認 |
| status | | `active` `draft` `archived`（既定 active） |

### 解説・検証（v2で追加）
| 列 | 内容 |
|---|---|
| explanation_short | 回答直後の一言解説（40字程度） |
| key_point | POINT。1〜3個を改行区切り |
| trap | ひっかけ注意（ある問題のみ） |
| calculation_steps | 計算過程。JSONは配列、CSVは改行または `;` 区切り（STEP1 何を求めるか〜STEP5 照合） |
| verified_answer | 独立に解き直した答え（1〜4 / A〜D）。公式解答は correct_answer |
| verification_status | `verified` `needs_review` `mismatch` `unverified`。公式解答と verified_answer が食い違えば自動で mismatch |
| current_rule_note | 旧制度問題で「現在の制度ではどうなるか」 |

別名の列も受け付けます: `official_answer`→correct_answer、`explanation_detailed`→explanation、`law_revision_status`→law_revision_flag（`needs_review`・`old_rule` も可）。

### 差分インポート（既存の問題に解説を追記）
`question_id` と追記したい列だけの行を取り込むと、既存の問題に重ねて更新します（問題文・画像・回答履歴はそのまま）。
「既存IDはスキップ」を選んでいても差分行は反映されます。

### 解説完成の基準
公式解答・選択肢1〜4・4つすべての選択肢解説・正解の理由・不正解の理由と正しい内容・POINT・（計算問題なら）計算過程・法令基準日・公式解答と検証結果の一致。
すべて満たしたものだけ「解説完成」。未完成でも出題はされ、画面では「解説準備中」と表示します。

## AI解説の作り方
1. 問題管理で「解説：解説未完成」などに絞り込み、「AI解説プロンプト」を押す（10問ずつ。クリップボードにコピー＋.md保存）
2. Claude に貼り付ける（図表のある問題は原本画像も一緒に渡す）
3. 返ってきた JSON をファイルに保存し、インポート画面で取り込む（差分として反映）
4. 「要確認をレビュー」で mismatch / needs_review だけを見直す

AIは公式解答を見ずに独立に解き、最後に照合します。不一致のときに公式解答へ合わせた理由を後付けしないよう、プロンプトで禁止しています。

## 検証
- **エラー（取り込まない）**: 必須欠落、ID重複（ファイル内）、正解番号不正、選択肢不足・同一選択肢、法令基準日なし・不正日付、課目不明
- **警告（取り込む）**: 解説・ポイント不足、既定値で補完、過去問の出典不足、基準日が設定より古いのに「確認済み」
- 既存IDは「スキップ」か「上書き」を選択。500件ずつ投入するので1万件規模でも可。

## 法改正の扱い
- `outdated` は既定で出題しない（設定で変更可）。問題画面に警告を表示。
- `needs_check` かつ 法令基準日 < 設定の法令基準日 → 「現在の法令では内容が異なる可能性があります」と表示。
- 問題管理で「基準日より古い」「要確認」で絞り込み、一括で見直せる。
