# CFP Study — Phase 1 設計書

> 目的: 2027年6月 CFP資格審査試験 6課目合格。学習効率と継続率を最大化する。
> 判断基準: 「これはCFP合格に実質的に貢献するか？」(Feature Gate)

---

## 0. 手元資料の確認結果（~/Downloads/CFP関係）

| 資料 | 内容 | アプリへの反映 |
|---|---|---|
| outline_cfp.pdf | 2026年度第2回 試験要項 | 50問/120分/四肢択一/1問2点、法令基準日の考え方（第2回=同年4/1施行済み法令） |
| guide.pdf | FP学習ガイド（2026/4/1改定） | **論点マスタの初期体系**（課目→大分類→中分類→小分類）を自動抽出して投入。FP1→ライフ、FP2→金融 … FP6→相続 |
| 20xx_0x_CFP0N_q/a.pdf | 2025第2回・2026第1回 公式過去問＋正解 | **Phase 1では取り込まない**（「無断複製転載禁止」）。形式だけ設計に反映 |
| CFP_hyoushisample.pdf | 表紙サンプル | 模試画面の注意事項 |
| FP1_*.pdf / tyokuzen_text | FP1級教材 | 使用しない（第三者著作物） |

過去問から分かった設計上の重要点:
- 選択肢は **1〜4**（A〜Dではない）。「設問A〜D」は1つの大問の中の小問ラベル → UIは **1〜4表記**に統一（混同防止）。
- 大問（問1）が**共通の事例・資料**を持ち、その下に（問題1〜4）がぶら下がる → `case_group`（共通事例文）を持つ構造が必須。
- 資料は**表**が多い → 問題文・事例文はMarkdown（表・太字）対応。
- 合格ライン: 直近11課目分で **25〜33問/50**（平均≒28問=56%）→ 模試の目安ラインに利用（設定で変更可）。

---

## 1. 要件整理

### Phase 1 で作るもの（MVP Freeze）
ホーム / 今日の最適学習 / 4択（1問ずつ）/ 正誤判定 / 段階的解説 / 次へ / 6課目×論点階層 / 回答履歴（回答時間含む）/ 正答率 / 習熟度 / SRS復習スケジュール / 苦手・誤答・未回答・ランダム・科目別 / 10問テスト / 50問120分模試 / 法令基準日・法改正フラグ / お気に入り・メモ / 検索 / 問題管理（CRUD・フィルタ）/ CSV・JSONインポート（検証付き）/ 最低限の分析（弱点TOP5・本番準備度）

### Phase 1 に「軽量版」で入れるもの（エンジン流用で低コスト・合格貢献あり）
- 時間指定（5分/10分/20分/しっかり）→ 同じ出題エンジンに問題数を渡すだけ
- MASTER/EXPLORE 配分と CORE/CHALLENGE/DISCOVERY/SURPRISE 内部分類 → 出題理由の表示にも使う
- 誤答直後の同論点フォロー（Adaptive）
- 今週の成長（論点別 先週→今週）、「以前3回間違えた問題を初めて正解」
- 実力診断（任意・6課目×2〜3問）
- 誤答原因のワンタップ入力（任意）
- UX学習の土台：イベント記録＋2ルールのみ（解説の既定開閉、既定セッション時間）
- 開発ガードレール：開発時間ログ／Idea Parking Lot／週次レビュー（開発者メニューに隔離）

### 作らない（Not Now）
AI類題生成（**スキーマのみ用意**）、知識マップ、時間帯分析、バッジ/ポイント/ランキング/SNS、AIチャット、PCM適応ロジック、凝ったダッシュボード、過度なアニメーション

---

## 2. 画面構成

```
下部タブ（4つだけ）: ホーム / 演習 / 分析 / 設定
問題画面・模試画面はタブを隠して全画面

ホーム            … 試験まであと○日（1行）／今日の最適学習カード＋[学習を始める]／
                     時間チップ(5・10・20分・しっかり)／6課目の習熟度バー／今日・今週の回答数
演習（選べる学習）  … AIに任せる／苦手攻略／Surprise 5／Challenge 5／計算特訓／
                     科目別（課目→大→中→小）／間違えた問題／未回答／ランダム／お気に入り／
                     10問テスト／本番模試／実力診断／検索
問題画面           … 上部: 3/18 ・ 課目 / 論点（小さく）・なぜこの問題?(i)
                     本文 → 選択肢1〜4（カード全体タップ）→ 下部固定[回答する]
回答後             … ○正解/×不正解 → この問題のポイント → [詳細解説▼] → [各選択肢▼] →
                     関連論点 / 簡単・普通・難しい / あとで復習 / ☆ / メモ / (誤答時)原因チップ
                     下部固定 [次へ]
セッション結果      … 正答数・時間／今日理解したこと／成長トピック／[もう5問] [ホームへ]
模試              … タイマー・問題パレット・見直しフラグ・提出 → 得点/正答率/分野別/誤答/所要時間
分析              … 本番準備度（5指標×課目）／弱点TOP5／今週の成長／論点ツリー（課目→論点）／
                     My CFP Profile（100問以降）
設定              … 試験日・法令基準日・表示の簡略化・選択肢シャッフル・ダークモード／
                     データ（バックアップ書き出し・復元）／問題管理／インポート／開発者メニュー
```

## 3. ユーザーフロー（最重要KPI: 起動→最初の回答 5秒以内）

```
起動(0s) → ホーム描画(〜1s, ローカルDBなので通信待ちなし)
        → [学習を始める] 1タップ(〜2s) → 問題表示(即時, 出題セットは起動時に事前計算)
        → 選択 → [回答する] → [次へ] … 親指ゾーン（画面下部固定）だけで完結
        → 結果 → 閉じる
```
- 時間チップを触らなければ「前回/学習済みの好み」の長さで開始（選ばせない）。
- 途中離脱しても回答は1問ごとに保存。次回ホームに「続きから」。

---

## 4. DB設計（IndexedDB / Dexie、ローカルファースト）

ストア（テーブル）一覧。`★`= インデックス

| ストア | 主キー | 主な項目 |
|---|---|---|
| `questions` | question_id | 11章の全項目＋拡張（下記）★subject ★topic_id ★source_type ★law_revision_flag ★status ★case_group_id |
| `caseGroups` | id | title, case_text(Markdown), subject, source_* |
| `taxonomy` | id | parent_id, level(subject/large/middle/small/topic), name, order, importance(1-3), guide_ref ★parent_id ★level |
| `attempts` | ++id | question_id★, session_id★, answered_at★, selected, correct, time_ms, mode, slot(CORE/CHALLENGE/DISCOVERY/SURPRISE), track(MASTER/EXPLORE), reason, self_rating, error_cause, explanation_opened, streak_before, wrong_count_before, difficulty, subject★, topic_id★ |
| `cards`（SRS状態） | question_id | level(0-4), streak, correct_count, wrong_count, last_answered_at, due_at★, interval_days, flagged(あとで復習), last_result |
| `sessions` | id | mode, started_at, ended_at, time_budget, question_ids, cursor, results, config（再開用） |
| `favorites` / `notes` | question_id | note text, updated_at |
| `settings` | key | exam_date, law_base_date, pass_line_ratio, simple_home, scheduler_config … |
| `uxEvents` | ++id | type(mode_selected/explanation_opened/session_completed…), at, payload |
| `devLog` | ++id | kind(dev/content_work), minutes, note, at |
| `ideas` | ++id | idea, purpose, contribution, effect, cost, created_at, status |

- 回答1件＝attempts 1行追記＋cards 1行更新（トランザクション）。集計は attempts から都度計算（1万件でも数十ms）。
- 将来の端末間同期: すべて Repository 層経由でアクセス → Firestore 実装を差し替え可能。Phase 1 は **JSONバックアップ書き出し/復元** で機種変更・PC移行に対応。

## 5. 問題データスキーマ（インポート形式 = JSON / CSV 共通）

必須: `question_id, subject, question_text, choice_a..choice_d, correct_answer, explanation, law_reference_date`

| 項目 | 型 | 説明 |
|---|---|---|
| question_id | string | 一意。例 `ORIG-TAX-0001` / `PAST-2026-1-05-012` |
| subject | enum | finance / realestate / life / risk / tax / inheritance（日本語課目名も可、自動変換） |
| category_large / middle / small | string | 学習ガイドの名称。未登録なら論点マスタに自動追加 |
| topic | string | 論点（最下層）。例「住宅借入金等特別控除」 |
| question_text | markdown | 表・太字可 |
| case_group_id | string? | 共通事例（大問）への参照 |
| choice_a〜choice_d | string | 画面表記は 1〜4 |
| correct_answer | A-D or 1-4 | どちらも受理 |
| explanation / explanation_a〜d | markdown | 総合解説 / 肢別解説 |
| key_point | string | 1〜3行の暗記ポイント |
| related_topics | string[] | 関連論点（`;`区切り） |
| difficulty | 1-5 | 既定3 |
| importance | 1-3 | 試験での重要度（出題選択に使用） |
| frequency | 1-3 | 出題頻度 |
| question_type | knowledge / calculation / case / reading | |
| source_type | official_past_exam / original / ai_variant | |
| source_year / source_exam / source_question_number | | 例 2026 / 1（第1回）/ 12 |
| parent_question_id / variant_spec | | 類題用: 元問題・変更可能パラメータ（数値・人物・条件・問い方） |
| calc_method | string? | 計算方法の要約（類題で維持する核） |
| law_reference_date | date | 法令基準日 |
| law_revision_flag | verified / needs_check / outdated | 確認済み / 要確認 / 旧制度問題 |
| tags | string[] | |
| status | active / draft / archived | |
| created_at / updated_at | datetime | 自動 |

**法改正警告**: `outdated` または `law_reference_date < 設定の法令基準日` かつ `needs_check` → 問題上部に「現在の法令では内容が異なる可能性があります」。`outdated` は既定で出題除外（設定で変更可）。

**インポート検証**: 必須項目欠落 / question_id重複（ファイル内・DB内）/ 正解が A-D・1-4 以外 / 選択肢不足・同一選択肢 / 法令基準日なし・不正日付 / 課目不明 / 難易度範囲外。→ プレビューでエラー行・警告行を表示し「正常行のみ取り込み」「既存IDは上書き/スキップ」を選択。1万件はチャンク投入（bulkPut 500件単位）。

## 6. 学習アルゴリズム

### 6.1 SRS（差し替え可能な `Scheduler` インターフェース）
| 結果 | 次回 |
|---|---|
| 不正解 | 翌日（level 1 苦手、streak 0） |
| 連続正解 1 / 2 / 3 / 4+ | 3日 / 7日 / 14日 / 30日（以降 ×2、上限90日） |
| 自己評価「難しい」 | 間隔 ×0.6 ／「簡単」×1.3 |
| 正解だが回答時間が本人平均の2倍超 | 間隔を1段階短く（「たまたま正解」対策） |

Level: 0 未回答 / 1 苦手（直近不正解）/ 2 学習中（連続1）/ 3 定着途中（連続2-3）/ 4 定着（連続4+）。間隔表は設定値なので後でFSRS等に置換可能。

### 6.2 習熟度（課目→大→中→小→論点、全階層で同一式）
- 問題ごとの得点: 各回答を「新しいほど重い」重み（半減期30日）で平均。難しい問題の正解は重く、遅い正解は0.8点。
- 忘却補正: 最終回答からの経過日数とSRS間隔から保持率 R を掛ける（しばらく解いていない論点は自然に下がる）。
- 少数データの暴れ防止: 事前値（初期0.5／実力診断後は診断結果）へ回答数に応じて寄せる。
- ノードの**習熟度**＝配下の問題得点の重要度加重平均。**カバー率**＝回答済み論点/問題のある論点 は別表示。

### 6.3 今日の最適学習（セッションビルダー）
1. 問題数 = 時間 ÷ 本人の平均所要時間（初期50秒/問）。5分≈5問、10分≈10問、20分≈18問、しっかり≈30問。
2. 配分: MASTER 70% / EXPLORE 30% を基準に、復習期限の溜まり具合・試験までの日数（近いほどMASTER）・本人の行動（Surprise多用なら EXPLORE +）で 50〜85% の範囲で自動調整。
3. 候補スコア = 復習期限超過 + 論点の苦手度 + 重要度 + 出題頻度 + 試験接近度 + 未学習論点ボーナス − 直近7日の課目偏りペナルティ。
4. スロット: CORE（期限・弱点）/ CHALLENGE（得意論点の難問）/ DISCOVERY（未学習論点）/ SURPRISE（全範囲ランダム）。
5. 並び: 同じ課目が連続しないようにインターリーブ。
6. 各問に理由を保存・表示（「3日前に間違えた問題です」「あなたの苦手論点です（債券 41%）」「忘却防止の復習です」「未学習の重要論点です」「Surprise」）。

### 6.4 Adaptive（セッション内）
誤答 → 2問後に同論点の別問題を挿入 → 正解 → 同論点のやや難しい問題を挿入（1セッション最大+3問）→ 以後はSRSが数日後に再確認。

### 6.5 本番準備度（合格確率は出さない）
課目ごとに5指標を並べるだけ: 直近正答率（直近14日）/ 最新模試得点（合格ライン目安56%との比較）/ 論点カバー率 / 苦手論点数 / 復習完了率（期限内に解いた割合）。

### 6.6 成長・プロフィール
- 今週の成長: 論点ごとに「7日前時点の習熟度 → 現在」を比較し上位を表示。苦手論点数の増減、新規習得論点数。
- 回答直後: 「以前3回間違えた問題を初めて正解」等を1行で。
- My CFP Profile（100問以降）: 得意 / 安定 / 成長中 / 重点強化。500問以降に「計算問題は時間が長い」「○日空くと正答率が下がる」等の特性。

### 6.7 UX学習（Phase 1 は記録＋2ルールのみ）
- 詳細解説の開封率が低い → 既定で閉じる。計算問題だけ開封率が高い → 計算問題は既定で開く。
- よく選ぶ時間 → ホームの既定時間に。

## 7. 技術構成

| 層 | 採用 | 理由 |
|---|---|---|
| UI | React + TypeScript + Vite | 保守性・型安全・高速ビルド |
| アプリ形態 | **PWA**（ホーム画面追加・オフライン動作） | 通勤中の電波なしでも使える。起動が速い |
| DB | IndexedDB（Dexie） | 1万問＋数万回答をローカルで即時集計。サーバ不要・無料 |
| スタイル | CSS変数トークン＋素のCSS | ライト/ダーク切替、依存を増やさない |
| CSV | PapaParse | 実績あるパーサ |
| テスト | Vitest | SRS・習熟度・出題・インポート検証を単体テスト |
| 配信 | 静的ホスティング（Firebase Hosting / Vercel 等） | 問題データは同梱せず端末内に取り込む |

ディレクトリ:
```
src/
  domain/      types.ts, subjects.ts           … 型と6課目定義
  engine/      scheduler.ts, mastery.ts, sessionBuilder.ts, readiness.ts, growth.ts, uxPrefs.ts
  data/        db.ts, repo.ts, importer.ts, validators.ts, seed/ (論点マスタ・ダミー問題)
  ui/          screens/, components/, styles/
docs/          設計書・インポート仕様・Idea Parking Lot
```
