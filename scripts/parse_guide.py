import re, json, unicodedata
L = open('txt/guide.pdf.txt').read().split('\n')
ranges = {'life':(175,1409),'finance':(1410,2027),'realestate':(2028,2474),'risk':(2475,3029),'tax':(3030,3363),'inheritance':(3364,3999)}
def norm(s):
    s = unicodedata.normalize('NFKC', s)
    s = re.sub(r'\s+', '', s)
    s = s.replace('※「FP実務と倫理」課目に該当','')
    return s
out = {}
for subj,(a,b) in ranges.items():
    lines = L[a-1:b]
    larges = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r'^([０-９0-9]+)．(.+)$', ln)
        if m and '●' not in ln and len(ln) < 60:
            larges.append({'name': norm(m.group(2)), 'middles': []})
            i += 1; continue
        m = re.match(r'^（([0-9０-９]+)）\s*(.*)$', ln)
        if m and larges:
            txt = m.group(2); j = i
            while '●' not in txt and j+1 < len(lines) and j - i < 4:
                j += 1
                nxt = lines[j]
                if re.match(r'^(（|[０-９]+．)', nxt): break
                txt += nxt
            name = norm(txt.split('●')[0])
            larges[-1]['middles'].append({'name': name, 'smalls': []})
            i = j + 1 if '●' in txt else i+1; continue
        m = re.match(r'^[　 ]*([0-9０-９]+)）\s*(.*)$', ln)
        if m and larges and larges[-1]['middles']:
            txt = m.group(2); j=i
            while '●' not in txt and j+1 < len(lines) and j-i < 3:
                j += 1; nxt = lines[j]
                if re.match(r'^(（|[０-９]+．|[　 ]*[0-9０-９]+）)', nxt): break
                txt += nxt
            name = norm(txt.split('●')[0])
            if name and len(name) < 50:
                larges[-1]['middles'][-1]['smalls'].append(name)
            i = j+1 if '●' in txt else i+1; continue
        i += 1
    out[subj] = larges
json.dump(out, open('guide_taxonomy.json','w'), ensure_ascii=False, indent=1)
for s,ls in out.items():
    print('##', s, len(ls))
    for l in ls:
        print('  ', l['name'], '|', ' / '.join(m['name'] + (f"[{len(m['smalls'])}]" if m['smalls'] else '') for m in l['middles']))
