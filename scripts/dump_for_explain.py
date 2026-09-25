"""解説作成用に、変換済み過去問JSONを読みやすいテキストへ書き出す（画像は別ファイル）。
使い方: python3 scripts/dump_for_explain.py <exam.json> <出力dir>"""
import base64, json, os, sys
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
d = json.load(open(src))
groups = {g['id']: g for g in d['case_groups']}
seen, lines = set(), []
N = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
def save_imgs(key, imgs):
    paths = []
    for i, im in enumerate(imgs or []):
        p = os.path.join(out, f'{key}_{i}.jpg')
        open(p, 'wb').write(base64.b64decode(im.split(',', 1)[1]))
        paths.append(p)
    return paths
for q in d['questions']:
    g = groups.get(q.get('case_group_id') or '')
    if g and g['id'] not in seen:
        seen.add(g['id'])
        lines.append(f"\n##### 事例 {g['id']} {g['title']}\n{g['case_text']}")
        for p in save_imgs(g['id'], g.get('images')): lines.append(f'[画像] {p}')
    lines.append(f"\n=== {q['question_id']} 公式解答:{q['correct_answer']} 法令基準日:{q['law_reference_date']} 型:{q['question_type']} 論点:{q['topic']}")
    lines.append(q['question_text'])
    for p in save_imgs(q['question_id'], q.get('images')): lines.append(f'[画像] {p}')
    for k in 'abcd': lines.append(f"{N[k.upper()]}. {q['choice_' + k]}")
open(os.path.join(out, 'questions.txt'), 'w').write('\n'.join(lines))
print(len(d['questions']), 'questions ->', out)
