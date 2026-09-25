"""生成した解説JSON（差分）を品質基準で点検する。アプリの quality.ts と同じ基準。"""
import json, re, sys
SHOWS = re.compile(r'正しくは|ではなく|が正しい|となる|となり|である|とされ|必要|限られ|できる|できない|含まれ|=|＝|→|逆である|誤り。.{6,}|している|される|という|いう。|ない。|なる。')
base = {q['question_id']: q for q in json.load(open(sys.argv[1]))['questions']}
ex = json.load(open(sys.argv[2]))['questions']
N = {'1': 'A', '2': 'B', '3': 'C', '4': 'D', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'}
bad, stats = [], {'verified': 0, 'mismatch': 0, 'needs_review': 0}
for e in ex:
    q = base.get(e['question_id'])
    if not q: bad.append((e['question_id'], '存在しないID')); continue
    off, ver = N[str(q['correct_answer'])], N.get(str(e.get('verified_answer', '')))
    st = e.get('verification_status')
    stats[st] = stats.get(st, 0) + 1
    probs = []
    if st == 'verified' and ver != off: probs.append(f'verified だが答えが不一致 {ver}≠{off}')
    if ver and ver != off and st != 'mismatch': probs.append('不一致なのに mismatch でない')
    for k in 'abcd':
        t = e.get('explanation_' + k, '')
        if len(t) < 8: probs.append(f'{k}の解説不足')
        else:
            false_stmt = t.startswith('×') or (not t.startswith('○') and 'ABCD'['abcd'.index(k)] != off)
            if false_stmt and not SHOWS.search(t): probs.append(f'{k}に正しい内容がない')
        if not t.startswith(('○', '×')): probs.append(f'{k}に○×がない')
    if not e.get('key_point'): probs.append('POINTなし')
    if not e.get('explanation_short'): probs.append('一言解説なし')
    qt = e.get('question_type', q['question_type'])
    if qt == 'calculation' and len(e.get('calculation_steps') or []) < 2: probs.append('計算過程なし')
    if re.search(r'公式解答が|公式の正解が', ' '.join(str(e.get(k, '')) for k in ['explanation', 'explanation_a', 'explanation_b', 'explanation_c', 'explanation_d'])): probs.append('公式解答を理由にしている')
    if probs: bad.append((e['question_id'], '; '.join(probs)))
missing = sorted(set(base) - {e['question_id'] for e in ex})
print(f"{len(ex)}問 {stats} 未作成 {len(missing)}")
for b in bad: print('  ✗', *b)
if missing: print('  未作成:', ' '.join(m.split('-')[-1] for m in missing))
