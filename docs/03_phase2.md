# Phase 2 以降（MVP Freeze 後）

## Phase 2（データ投入）— 最優先

### 済（2026-09-24）公式過去問 550問を変換
- `python3 scripts/import_past_exams.py ~/Downloads/CFP関係 ~/Downloads/CFP関係/import`
- 出力はリポジトリ外（~/Downloads/CFP関係/import/）。回・課目ごとのJSON 11個＋全部入り1個。
- 2025年度第2回（ライフは手元にPDFなし）5課目＋2026年度第1回6課目。正解は模範解答PDFから自動取得。
- 表・グラフ・図を含む問題は原本ページの画像を添付。大問の共通文は「事例」として共有。
- 法令基準日: 第2回=2025-04-01、第1回=2025-10-01（推定）。全問「要確認」。
- 未対応: 解説・ポイント（タグ「解説未作成」）、FP学習ガイドの分類へのひも付け（今は大問のテーマで分類）。
- 取り込み検証: `src/test/pastExams.local.test.ts`（ファイルがある環境のみ実行）。

### 残り
1. 公式過去問の取り込み（~/Downloads/CFP関係 の 2025第2回・2026第1回）。
   - 「無断複製転載禁止」のため、アプリ本体には同梱しない。自分の端末にだけ私的利用として取り込む。
   - 正解は *_a.pdf から自動で取れる。問題文は PDF 抽出→人手で整形（表・事例文）。解説・ポイントは自作。
   - source_type=official_past_exam、source_year/exam/question_number を必ず付ける。
2. 各問に FP学習ガイドの分類（大・中・小）と論点を付与。
3. 2027年6月試験の法令基準日を試験要項で確定 → 設定を更新し、needs_check の問題を見直す。

## Phase 3 候補（Idea Parking Lot で評価してから）
- AI類題生成（スキーマ parent_question_id / calc_method / variant_spec は準備済み）
- 学習計画の自動生成（試験日からの逆算量の表示）
- 端末間同期（repo.ts を Firestore 実装に差し替え）

## Not Now（原則やらない）
ランキング・SNS・バッジ・ポイント・AIチャット・詳細な性格分析・過度なアニメーション
