"""
公式過去問PDF（日本FP協会公表）→ アプリのインポート用JSON に変換する。

- 「無断複製転載禁止」のため、出力はアプリ本体に同梱しない（私的利用として自分の端末にだけ取り込む）。
- 問題文・選択肢・正解（*_a.pdf）・出典を抽出。解説は含まれないので「解説未作成」のタグを付ける。
- 表・グラフを含む問題は文字が崩れるため、該当ページを画像（data URL）で添付する。

使い方:
  pip3 install --user pypdf pypdfium2 pillow
  python3 scripts/import_past_exams.py ~/Downloads/CFP関係 ~/Downloads/CFP関係/import
"""
import base64, glob, io, json, os, re, sys, unicodedata
import pypdf
import pypdfium2 as pdfium

SUBJECTS = {1: 'finance', 2: 'realestate', 3: 'life', 4: 'risk', 5: 'tax', 6: 'inheritance'}
SUBJECT_NAMES = {1: '金融資産運用設計', 2: '不動産運用設計', 3: 'ライフプランニング・リタイアメントプランニング', 4: 'リスクと保険', 5: 'タックスプランニング', 6: '相続・事業承継設計'}
# 法令基準日: 第2回=同年4月1日（試験要項で確認済み）、第1回=前年10月1日（通例。要項で要確認）
def law_date(year, exam):
    return f'{year}-04-01' if exam == 2 else f'{year - 1}-10-01'

FW = str.maketrans('０１２３４５６７８９', '0123456789')
CHOICE_RE = re.compile(r'^\s*([１２３４])\s*[．.]\s*(.*)$')
FIGURE_RE = re.compile(r'＜(資料|図|表|設例の資料)|〈資料|下記の?(表|グラフ|図)|下表|下図|グラフ')


def page_lines(reader):
    """ページごとの行（ヘッダー・フッター除去）"""
    out = []
    for pi, page in enumerate(reader.pages):
        for ln in (page.extract_text() or '').split('\n'):
            s = ln.rstrip()
            if '無断複製転載禁止' in s:
                continue
            if re.match(r'^\s*\S+\s*20\d\d年度第\d回\s*$', s) or re.match(r'^\s*20\d\d年度第\d回\s+\S+\s*$', s):
                continue
            out.append((pi, s))
    return out


def answers(path):
    t = pypdf.PdfReader(path).pages[0].extract_text()
    body = t.split('合格ライン')[0]
    nums = []
    for ln in body.split('\n'):
        toks = ln.split()
        if toks and all(re.fullmatch(r'[１２３４1-4]', x) for x in toks):
            nums += [int(x.translate(FW)) for x in toks]
    pass_line = re.search(r'５０問中([０-９]+)問', t)
    return nums, int(pass_line.group(1).translate(FW)) if pass_line else None


def looks_tabular(lines):
    """表・図を含むか: 図表の見出し、縦書き見出し、短い語が3つ以上並ぶ行や数値の並ぶ行が複数ある"""
    raw = '\n'.join(lines)
    if FIGURE_RE.search(raw) or sum(0 < len(l.strip()) <= 2 for l in lines) >= 6:
        return True
    rows = 0
    for l in lines:
        toks = l.split()
        if len(toks) >= 3 and sum(len(t) <= 8 for t in toks) >= 3:
            rows += 1
        elif len(re.findall(r'[\d０-９][\d０-９,，.．]*', l)) >= 3 and len(toks) >= 3:
            rows += 1
    return rows >= 3


def drop_vertical_runs(lines):
    """縦書きの表見出し（1〜2文字の行が続く部分）は文字化けになるので除く"""
    out, run = [], []
    for ln in lines:
        if 0 < len(ln.strip()) <= 2:
            run.append(ln)
            continue
        if len(run) < 4:
            out += run
        run = []
        out.append(ln)
    if len(run) < 4:
        out += run
    return out


def join_wrapped(lines):
    """PDFの折り返しを段落に戻す（表の行は結合しない）"""
    out = []
    for ln in lines:
        s = ln.strip()
        if not s:
            if out and out[-1] != '':
                out.append('')
            continue
        prev = out[-1] if out else ''
        numeric = len(re.findall(r'\d[\d,，.．]*', prev)) >= 4
        starts_item = re.match(r'^([（(]|[・①-⑳]|[ア-ン][．.]|[１-９][．.]|＜|〈|※|（ア）)', s)
        if prev and len(prev) >= 28 and not prev.endswith(('。', '：', ':')) and not numeric and not starts_item:
            out[-1] = prev + s
        else:
            out.append(s)
    while out and out[-1] == '':
        out.pop()
    return '\n'.join(out)


def clean(lines):
    return join_wrapped(drop_vertical_runs(lines))


def render_pages(pdf, pages):
    imgs = []
    for p in sorted(pages):
        img = pdf[p].render(scale=1.4).to_pil().convert('L')
        w, h = img.size
        img = img.crop((int(w * 0.07), int(h * 0.07), int(w * 0.95), int(h * 0.93)))
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=55, optimize=True)
        imgs.append('data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode())
    return imgs


def topic_of(text, fallback):
    t = re.sub(r'^（設問[Ａ-Ｚ]）', '', text.strip())
    m = re.match(r'^(.{2,40}?)(に関する|について)', t)
    if not m or re.match(r'^(次の|下記|上記|設例|前記)', m.group(1)) or '。' in m.group(1) or len(m.group(1)) > 30:
        return fallback
    return tidy(m.group(1))


def tidy(s):
    """閉じていない括弧を除く"""
    if s.count('「') > s.count('」'):
        s = s.replace('「', '')
    if s.count('（') > s.count('）'):
        s = s.replace('（', '')
    return s.strip()


def qtype(choices, has_fig, has_case):
    numeric = sum(bool(re.match(r'^[\d０-９,，.．\s]+(円|万円|千円|億円|%|％|倍|年|ヵ月|か月|㎡|日|歳|人|点)', c)) for c in choices)
    if numeric >= 3:
        return 'calculation'
    if has_fig:
        return 'reading'
    return 'case' if has_case else 'knowledge'


def parse_exam(qpath, apath):
    m = re.search(r'(\d{4})_0(\d)_CFP0(\d)_q', qpath)
    year, exam, no = int(m.group(1)), int(m.group(2)), int(m.group(3))
    subject = SUBJECTS[no]
    ans, pass_line = answers(apath)
    reader = pypdf.PdfReader(qpath)
    pdf = pdfium.PdfDocument(qpath)
    lines = page_lines(reader)

    # 問N（大問）と（問題n）で分割
    groups, cur_g, cur_q = [], None, None
    for pi, s in lines:
        gm = re.match(r'^\s*問([０-９0-9]+)\s*$', s)
        qm = re.match(r'^\s*（問題([０-９0-9]+)）\s*$', s)
        if gm:
            cur_g = {'no': int(gm.group(1).translate(FW)), 'intro': [], 'pages': set(), 'qs': []}
            groups.append(cur_g)
            cur_q = None
            continue
        if qm and cur_g is not None:
            cur_q = {'no': int(qm.group(1).translate(FW)), 'lines': [], 'pages': set()}
            cur_g['qs'].append(cur_q)
            continue
        if cur_q is not None:
            cur_q['lines'].append(s); cur_q['pages'].add(pi)
        elif cur_g is not None:
            cur_g['intro'].append(s); cur_g['pages'].add(pi)

    prefix = f'PAST-{year}-{exam}-{no:02d}'
    questions, case_groups, problems = [], [], []
    for g in groups:
        intro_raw = '\n'.join(g['intro'])
        flat = re.sub(r'\s+', '', intro_raw)
        heading = re.search(r'([^、。]{2,40}?)(に関する|について|に関して)以下の', flat) or re.search(r'^(.{2,40}?)(に関する|について|に関して)', flat)
        heading = tidy(re.sub(r'^.*に基づき、?', '', heading.group(1))) if heading else ''
        if not heading or re.match(r'^(以下の設問|問\d)', heading):
            # 大問の指示文にテーマが無い → 最初の設問のテーマを使う
            first = clean(g['qs'][0]['lines'][:4]) if g['qs'] else ''
            heading = topic_of(first, f'問{g["no"]}')
        # 定型の指示文を除いた残りが事例・資料
        body_lines = [l for l in g['intro'] if not re.search(r'答えを１～４の中から|以下の設問', l)]
        intro_text = clean(body_lines)
        instr = clean(g['intro'])
        g_fig = looks_tabular(g['intro'])
        gid = None
        if len(re.sub(r'\s', '', intro_text)) >= 20 or g_fig:
            gid = f'{prefix}-G{g["no"]:02d}'
            cg = {'id': gid, 'subject': subject, 'title': f'問{g["no"]} {heading}', 'case_text': instr}
            if g_fig:
                cg['images'] = render_pages(pdf, g['pages'])
            case_groups.append(cg)
        for q in g['qs']:
            ls = q['lines']
            # 最後の 1〜4 の並びを選択肢とみなす
            idx = {}
            for i in range(len(ls) - 1, -1, -1):
                cm = CHOICE_RE.match(ls[i])
                if cm:
                    k = int(cm.group(1).translate(FW))
                    if k not in idx and all(k < kk for kk in idx):
                        idx[k] = i
                if len(idx) == 4:
                    break
            if sorted(idx) != [1, 2, 3, 4] or not (idx[1] < idx[2] < idx[3] < idx[4]):
                problems.append(f'{prefix} 問題{q["no"]}: 選択肢を検出できません')
                continue
            stem = ls[:idx[1]]
            chs = []
            for k in (1, 2, 3, 4):
                end = idx[k + 1] if k < 4 else len(ls)
                seg = [CHOICE_RE.match(ls[idx[k]]).group(2)] + ls[idx[k] + 1:end]
                chs.append(clean(seg))
            stem_raw = '\n'.join(stem)
            q_fig = looks_tabular(stem) or looks_tabular(sum((ls[idx[k]:(idx[k + 1] if k < 4 else len(ls))] for k in (1, 2, 3, 4)), []))
            n = q['no']
            if n > len(ans):
                problems.append(f'{prefix} 問題{n}: 正解が見つかりません')
                continue
            correct = ans[n - 1]
            row = {
                'question_id': f'{prefix}-{n:03d}',
                'subject': subject,
                'category_large': heading,
                'topic': topic_of(clean(stem), heading),
                'question_text': clean(stem),
                'case_group_id': gid,
                'choice_a': chs[0], 'choice_b': chs[1], 'choice_c': chs[2], 'choice_d': chs[3],
                'correct_answer': str(correct),
                'explanation': f'公式の解説はありません（正解：{correct}）。模範解答は日本FP協会の公表資料による。',
                'key_point': '',
                'difficulty': 3, 'importance': 3, 'frequency': 2,
                'question_type': qtype(chs, q_fig or g_fig, bool(gid)),
                'source_type': 'official_past_exam',
                'source_year': year, 'source_exam': exam, 'source_question_number': n,
                'law_reference_date': law_date(year, exam),
                'law_revision_flag': 'needs_check',
                'tags': ['過去問', f'{year}年度第{exam}回', '解説未作成'] + (['原本画像あり'] if q_fig or g_fig else []),
                'status': 'active',
            }
            if q_fig:
                pages = q['pages'] - (g['pages'] if gid and g_fig else set())
                if pages:
                    row['images'] = render_pages(pdf, pages)
            questions.append(row)
    return {
        'label': f'{year}年度第{exam}回 {SUBJECT_NAMES[no]}', 'questions': questions, 'case_groups': case_groups,
        'problems': problems, 'pass_line': pass_line, 'answer_count': len(ans),
    }


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    all_q, all_g, report = [], [], []
    for qpath in sorted(glob.glob(os.path.join(src, '20*_CFP0*_q.pdf'))):
        apath = qpath.replace('_q.pdf', '_a.pdf')
        if not os.path.exists(apath):
            report.append(f'{os.path.basename(qpath)}: 解答PDFなし → スキップ')
            continue
        r = parse_exam(qpath, apath)
        name = os.path.basename(qpath).replace('_q.pdf', '')
        with open(os.path.join(dst, f'{name}.json'), 'w') as f:
            json.dump({'questions': r['questions'], 'case_groups': r['case_groups']}, f, ensure_ascii=False)
        imgs = sum(len(q.get('images', [])) for q in r['questions']) + sum(len(g.get('images', [])) for g in r['case_groups'])
        report.append(f"{r['label']}: {len(r['questions'])}/50問・正解{r['answer_count']}件・事例{len(r['case_groups'])}・画像{imgs}枚・合格ライン{r['pass_line']}問"
                      + ''.join(f'\n    ⚠ {p}' for p in r['problems']))
        all_q += r['questions']; all_g += r['case_groups']
    with open(os.path.join(dst, 'past_exams_all.json'), 'w') as f:
        json.dump({'questions': all_q, 'case_groups': all_g}, f, ensure_ascii=False)
    print('\n'.join(report))
    print(f'合計 {len(all_q)}問 → {dst}/past_exams_all.json ({os.path.getsize(os.path.join(dst, "past_exams_all.json")) / 1e6:.1f}MB)')


if __name__ == '__main__':
    main(os.path.expanduser(sys.argv[1]), os.path.expanduser(sys.argv[2]))
