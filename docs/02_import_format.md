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

## 検証
- **エラー（取り込まない）**: 必須欠落、ID重複（ファイル内）、正解番号不正、選択肢不足・同一選択肢、法令基準日なし・不正日付、課目不明
- **警告（取り込む）**: 解説・ポイント不足、既定値で補完、過去問の出典不足、基準日が設定より古いのに「確認済み」
- 既存IDは「スキップ」か「上書き」を選択。500件ずつ投入するので1万件規模でも可。

## 法改正の扱い
- `outdated` は既定で出題しない（設定で変更可）。問題画面に警告を表示。
- `needs_check` かつ 法令基準日 < 設定の法令基準日 → 「現在の法令では内容が異なる可能性があります」と表示。
- 問題管理で「基準日より古い」「要確認」で絞り込み、一括で見直せる。
