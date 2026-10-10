"""過去問の「出題分野」と代表的な用語の出題件数を集計し、Markdown にする（件数のみ。問題文・選択肢・資料は一切出力しない）。

使い方:
  python3 scripts/make_past_exam_stats.py <インポートJSONのフォルダ> > past_exam_stats.md

入力は import_past_exams.py が作る 2025_02_CFP01.json のような試験ごとのファイル。
合算ファイル（past_exams_all.json など）は二重に数えてしまうので読まない。
出力は lectures ブランチの tools/past_exam_stats.md に置き、課目・分類の確認の参考資料にする。
過去問の本文は無断転載禁止のため、リポジトリ（公開）には集計だけを載せる。
"""
import collections
import glob
import json
import os
import re
import sys

SUBJECTS = [('finance', '金融資産運用設計'), ('realestate', '不動産運用設計'), ('life', 'ライフプランニング・リタイアメントプランニング'),
            ('risk', 'リスクと保険'), ('tax', 'タックスプランニング'), ('inheritance', '相続・事業承継設計')]

# 課目の境界で迷いやすい用語。件数は「その用語が問題文・選択肢・事例に出てくる問題の数」で、分類そのものではない
TERMS = [
    '終価係数', '現価係数', '年金終価係数', '年金現価係数', '減債基金係数', '資本回収係数', '相関係数', 'ベータ',
    '必要収益率', '期待収益率', 'キャッシュフロー表', '住宅ローン', '繰上げ返済', '教育資金', '退職一時金', '企業年金', 'iDeCo', '個人型',
    'NISA', '配当', '譲渡所得', '株式等', '源泉分離', '損益通算', '配当控除', '外国税額控除',
    '遺族年金', '障害年金', '老齢基礎年金', '老齢厚生年金', '在職老齢年金', '健康保険', '介護保険', '雇用保険', '労災',
    '必要保障額', '死亡保険金', '解約返戻金', '個人年金保険', '保険料控除', '地震保険', '火災保険', '自動車保険', '賠償責任', '法人契約',
    '不動産所得', '減価償却', '固定資産税', '小規模宅地', '借地権', '定期借地', '建築基準法', '都市計画法', '借地借家法', '宅地建物取引', 'NOI', 'DCF', 'IRR', '利回り',
    '贈与税', '相続時精算課税', '暦年課税', '配偶者控除', '基礎控除', '遺留分', '遺言', '遺産分割', '成年後見', '信託',
    '自社株', '非上場', '類似業種', '事業承継', '役員退職金', '法人税', '消費税', 'インボイス', '青色申告',
]


def load(folder: str):
    rows = {}
    for f in sorted(glob.glob(os.path.join(folder, '20*_CFP0[1-6].json'))):
        d = json.load(open(f, encoding='utf-8'))
        for q in d if isinstance(d, list) else d.get('questions', []):
            if q.get('subject'):
                rows[q['question_id']] = q
    return list(rows.values())


def text_of(q):
    return ' '.join(str(q.get(k, '')) for k in ('question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'case_text'))


def main(folder: str):
    qs = load(folder)
    exams = sorted({re.match(r'PAST-(\d{4})-(\d)', q['question_id']).groups() for q in qs})
    per = collections.Counter(q['subject'] for q in qs)
    out = [
        '# 過去問の出題分野・用語の集計（参考資料）', '',
        f'対象：{" / ".join(f"{y}年度第{n}回" for y, n in exams)}（{len(qs)}問・各課目 {min(per.values())}問）。',
        '公式過去問の本文は無断転載禁止のため、**件数だけ**を載せています。問題文・選択肢・数値は含みません。',
        '', '使い方：課目・中分類を決めるときの**裏付け**に使う（「この知識は実際にどの課目で出ているか」）。',
        '件数は少ないので、「出ていない＝出ない」とは読まないこと。用語の件数は、その語が出てくる問題の数であり、分類そのものではない。', '',
        '## 1. 出題分野別の問題数（試験の出題分野名による）', '',
    ]
    for sid, name in SUBJECTS:
        c = collections.Counter((q.get('category_large') or q.get('topic') or '（不明）') for q in qs if q['subject'] == sid)
        out += [f'### {name}（{per[sid]}問）', '', '| 出題分野 | 問題数 |', '|---|---|']
        out += [f'| {k} | {v} |' for k, v in c.most_common()]
        out.append('')
    out += ['## 2. 境界で迷いやすい用語が、どの課目の問題に出ているか', '',
            '| 用語 | ' + ' | '.join(['金融', '不動産', 'ライフ', 'リスク', 'タックス', '相続']) + ' | 計 |', '|---|' + '---|' * 7]
    for t in TERMS:
        hit = collections.Counter(q['subject'] for q in qs if t in text_of(q))
        if not sum(hit.values()):
            continue
        out.append(f'| {t} | ' + ' | '.join(str(hit.get(s, 0) or '') for s, _ in SUBJECTS) + f' | {sum(hit.values())} |')
    out += ['', '※ 列は左から 金融／不動産／ライフ／リスク／タックス／相続。'
            '「相関係数」は金融（ポートフォリオ理論）、6つの係数（終価・現価など）はライフで出題されている、というように、同じ「係数」でも課目が違う点に注意。']
    print('\n'.join(out))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
