# CFP Study

2027年6月 CFP資格審査試験 6課目合格のための学習アプリ（Phase 1）。
スマホ優先の PWA。データは端末のブラウザ内（IndexedDB）に保存し、サーバーは不要。

## 使い方
```bash
npm install
npm run dev        # http://localhost:5173 （--host 付きなので同じWi-Fiのスマホからも開ける）
npm test           # エンジン・DB・UIのテスト
npm run build      # dist/ に静的ファイルを出力（Firebase Hosting / Vercel などにそのまま置ける）
```
- ホーム画面への追加（PWA・オフライン）には HTTPS 配信が必要。配信先を決めたら `dist/` をデプロイする。
- 学習データは端末ごと。設定 → バックアップ で JSON を書き出して保管・移行する。

## ドキュメント
- `docs/01_design.md` 設計（要件・画面・DB・アルゴリズム・技術構成）
- `docs/02_import_format.md` 問題データのインポート仕様
- `docs/03_phase2.md` 次にやること

## 論点マスタ
`src/data/seed/taxonomy.json` は FP学習ガイド（2026/4/1改定）の見出しから生成。改定時は
`python3 scripts/parse_guide.py`（PDFテキスト→見出しJSON）→ `python3 scripts/build_taxonomy.py <json>` で再生成し、
`src/data/bootstrap.ts` の `SEED_VERSION` を上げる（既存ノードは上書きしない）。

## 構成
```
src/domain   型・6課目定義
src/engine   scheduler(SRS) / mastery(習熟度) / sessionBuilder(今日の最適学習) / adaptive / insights(成長・準備度・Profile・UX学習)
src/data     db(Dexie) / repo(データアクセス層) / validate / importer / bootstrap / seed
src/ui       画面とコンポーネント
```
