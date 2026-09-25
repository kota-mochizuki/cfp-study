"""作業用の解説JSONの特定項目を置き換え、試験ごとのファイルを組み立て直す。
使い方: python3 patch_explanation.py <exam> <question_id> <field> <text> [<question_id> <field> <text> ...]"""
import glob, json, sys
exam, args = sys.argv[1], sys.argv[2:]
fixes = [args[i:i + 3] for i in range(0, len(args), 3)]
for f in glob.glob(f'work/{exam}.part*.json'):
    d = json.load(open(f)); changed = False
    for e in d:
        for qid, field, text in fixes:
            if e['question_id'] == qid: e[field] = text; changed = True
    if changed: json.dump(d, open(f, 'w'), ensure_ascii=False, indent=0)
qs = []
for f in sorted(glob.glob(f'work/{exam}.part*.json')): qs += json.load(open(f))
json.dump({'questions': qs}, open(f'{exam}_explanations.json', 'w'), ensure_ascii=False, indent=0)
print(exam, len(qs))
