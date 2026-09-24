"""FP学習ガイド(guide.pdf)から抽出した見出しJSONを、アプリの論点マスタ(フラットなノード配列)に変換する。
使い方: python3 scripts/parse_guide.py (guide_taxonomy.json生成) → python3 scripts/build_taxonomy.py <guide_taxonomy.json>
学習ガイド改定時(毎年4/1)に再実行する。"""
import json, re, sys
src = json.load(open(sys.argv[1]))
nodes = []
for subj, larges in src.items():
    for li, l in enumerate(larges, 1):
        lid = f"{subj}.L{li:02d}"
        nodes.append({"id": lid, "parentId": subj, "level": "large", "name": l["name"], "order": li})
        for mi, m in enumerate(l["middles"], 1):
            name = re.split(r'\d+\)', m["name"])[0]
            name = re.sub(r'\d+(不動産運用設計|リスクマネジメント|タックスプランニング|相続・事業承継設計|金融資産運用設計)$', '', name)
            mid = f"{lid}.M{mi:02d}"
            nodes.append({"id": mid, "parentId": lid, "level": "middle", "name": name, "order": mi})
            smalls = list(m["smalls"])
            first = re.search(r'\d+\)(.+)$', m["name"])
            if first and smalls:
                smalls = [first.group(1)] + smalls
            for si, s in enumerate(smalls, 1):
                s = re.sub(r'^(ステップ\d+)/', r'\1 ', s)
                nodes.append({"id": f"{mid}.S{si:02d}", "parentId": mid, "level": "small", "name": s, "order": si})
json.dump(nodes, open('src/data/seed/taxonomy.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(nodes), 'nodes')
