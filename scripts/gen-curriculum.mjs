// 配信講義の全体カリキュラム（lectures/curriculum.json）を論点マスタから生成する。
//   node scripts/gen-curriculum.mjs [出力フォルダ。省略時は ./lectures]
// 2026-10-11〜2027-04-30 の毎日 朝7:00（30分・確認問題5問）／昼12:00（15分・3問）／夕17:00（15分・3問）。
// 初日(10/11)の昼は開始前に過ぎているので置かない。最後の3枠は課目横断の総整理。
// 課目ごとに「配信枠の分数」を時間軸に並べ、中分類の重み(W)に比例した長さを割り当てる。
// 既に配信済み（status=delivered）の回は書き換えない。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] ?? 'lectures';
const nodes = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/data/seed/taxonomy.json'), 'utf8'));
const ORDER = ['finance', 'realestate', 'life', 'risk', 'tax', 'inheritance'];
const START = '2026-10-11';
const END = '2027-04-30';
const SLOTS = [['am', 30, 5], ['noon', 15, 3], ['pm', 15, 3]]; // [枠, 想定分数, 確認問題の数]

/**
 * 中分類の相対的な重み（旧「講義回数」）。書いていない中分類は 1。課目内の全枠の分数に比例して配分する。
 * 0 = 単独の回を作らず、直前の回（課目の先頭なら先頭の回）に含める。
 */
const W = {
  finance: {
    'L01.M01': 0, 'L01.M05': 0,
    'L02.M01': 0, 'L02.M02': 3, 'L02.M03': 2, 'L02.M05': 0, 'L02.M06': 4, 'L02.M07': 3, 'L02.M08': 2, 'L02.M09': 2, 'L02.M10': 3,
    'L03.M01': 2, 'L03.M02': 2, 'L03.M04': 2,
    'L04.M01': 0, 'L04.M05': 0,
    'L05.M01': 0,
    'L06.M01': 3,
    'L07.M01': 3, 'L07.M03': 2,
    'L08.M01': 0, 'L08.M02': 2, 'L08.M03': 3,
    'L09.M03': 0,
    'L10.M01': 0, 'L10.M08': 2, 'L10.M09': 0,
    'L11.M02': 0, 'L11.M04': 0,
    'L12.M02': 0, 'L12.M03': 0, 'L12.M04': 0, 'L12.M05': 0, 'L12.M06': 0,
  },
  realestate: {
    'L01.M01': 0, 'L02.M02': 0,
    'L03.M01': 4, 'L03.M02': 0, 'L03.M03': 2, 'L03.M04': 2, 'L03.M05': 2, 'L03.M06': 2,
    'L04.M03': 3,
    'L05.M01': 0, 'L05.M03': 3, 'L05.M05': 2, 'L05.M07': 0, 'L05.M08': 2,
    'L06.M01': 0, 'L06.M02': 2, 'L06.M03': 4, 'L06.M04': 2, 'L06.M06': 2, 'L06.M07': 4,
    'L07.M05': 0, 'L07.M08': 2, 'L07.M10': 3,
    'L08.M01': 0, 'L08.M04': 0, 'L08.M05': 2, 'L08.M06': 0, 'L08.M07': 0,
    'L09.M01': 0,
  },
  life: {
    'L01.M02': 0, 'L01.M03': 0, 'L01.M04': 0, 'L01.M05': 0,
    'L02.M01': 2, 'L02.M02': 0, 'L02.M03': 0, 'L02.M04': 0, 'L02.M05': 0, 'L02.M06': 2, 'L02.M08': 0, 'L02.M09': 0,
    'L03.M02': 0, 'L03.M03': 0, 'L04.M02': 0,
    'L05.M01': 0, 'L05.M02': 2,
    'L06.M01': 0, 'L07.M01': 0, 'L07.M02': 0, 'L07.M03': 0,
    'L08.M01': 0, 'L08.M02': 0, 'L08.M03': 0,
    'L09.M01': 0, 'L09.M02': 0, 'L09.M03': 0, 'L09.M07': 2, 'L09.M08': 0, 'L09.M10': 0,
    'L10.M02': 0, 'L10.M03': 0, 'L10.M04': 0, 'L10.M05': 0, 'L10.M06': 0,
    'L11.M01': 0,
    'L12.M01': 4, 'L12.M02': 2,
    'L13.M01': 2, 'L13.M02': 4,
    'L14.M01': 0, 'L14.M03': 0, 'L14.M04': 0, 'L14.M05': 0, 'L14.M06': 0, 'L14.M07': 0, 'L14.M08': 2,
    'L15.M01': 0, 'L15.M02': 0, 'L15.M06': 0,
    'L16.M01': 3, 'L16.M02': 6, 'L16.M03': 3, 'L16.M04': 4, 'L16.M06': 0,
    'L18.M01': 2,
    'L19.M01': 3, 'L19.M02': 2,
    'L20.M01': 0, 'L20.M02': 0,
  },
  risk: {
    'L01.M03': 0, 'L01.M04': 0,
    'L02.M02': 3, 'L02.M04': 0, 'L02.M05': 2, 'L02.M06': 0,
    'L03.M03': 0, 'L03.M04': 0,
    'L04.M01': 2, 'L04.M04': 0, 'L04.M07': 0, 'L04.M08': 0, 'L04.M09': 0, 'L04.M10': 0,
    'L05.M02': 0, 'L05.M03': 0, 'L05.M04': 0, 'L05.M05': 0, 'L05.M06': 0,
    'L06.M04': 2, 'L06.M05': 0,
    'L07.M01': 0,
    'L08.M01': 2, 'L08.M04': 0,
    'L09.M02': 0, 'L09.M03': 0,
    'L10.M01': 2, 'L10.M02': 2,
    'L11.M01': 0,
    'L12.M01': 4,
    'L13.M01': 0, 'L13.M02': 2, 'L13.M03': 3, 'L13.M04': 2, 'L13.M05': 0, 'L13.M07': 0, 'L13.M08': 0,
    'L15.M03': 0, 'L15.M04': 0,
    'L18.M01': 0,
    'L19.M02': 0, 'L19.M03': 0, 'L19.M05': 0,
    'L20.M01': 0,
  },
  tax: {
    'L01.M02': 0, 'L01.M03': 0, 'L01.M04': 0,
    'L02.M03': 12, 'L02.M04': 10, 'L02.M05': 2, 'L02.M08': 0,
    'L03.M01': 2,
    'L04.M02': 2, 'L04.M03': 8, 'L04.M06': 2,
    'L06.M02': 3, 'L06.M03': 2,
    'L07.M02': 0,
    'L08.M01': 0, 'L08.M02': 0, 'L08.M03': 0, 'L08.M06': 0, 'L08.M08': 0, 'L08.M09': 0, 'L08.M11': 0, 'L08.M12': 0,
    'L09.M03': 0, 'L09.M04': 0, 'L09.M05': 0,
    'L10.M01': 0,
  },
  inheritance: {
    'L01.M02': 0, 'L01.M03': 0,
    'L02.M02': 0, 'L02.M03': 0, 'L02.M04': 2, 'L02.M06': 2, 'L02.M09': 0,
    'L03.M02': 0, 'L03.M03': 0,
    'L04.M01': 0, 'L04.M04': 0, 'L04.M05': 2,
    'L05.M01': 0, 'L05.M04': 0,
    'L06.M01': 0, 'L06.M02': 0, 'L06.M04': 0,
    'L07.M01': 0, 'L07.M03': 3,
    'L08.M02': 2, 'L08.M03': 0,
    'L09.M01': 0, 'L09.M02': 2, 'L09.M03': 2,
    'L10.M02': 0, 'L10.M03': 0,
    'L11.M01': 0, 'L11.M02': 2,
    'L12.M01': 0, 'L12.M04': 0,
    'L13.M01': 2,
    'L14.M01': 0, 'L14.M02': 5, 'L14.M04': 0, 'L14.M05': 2,
    'L15.M01': 0,
    'L16.M01': 0, 'L16.M02': 0, 'L16.M04': 0,
    'L17.M02': 0, 'L17.M03': 0, 'L17.M04': 0, 'L17.M05': 0, 'L17.M06': 0, 'L17.M07': 0, 'L17.M08': 0,
    'L18.M02': 0, 'L18.M04': 0, 'L18.M05': 0,
    'L19.M02': 0, 'L19.M03': 0, 'L19.M04': 0, 'L19.M05': 0, 'L19.M06': 0,
    'L20.M02': 0, 'L20.M03': 0, 'L20.M04': 0,
    'L21.M01': 4,
    'L22.M02': 2,
    'L23.M01': 0,
    'L24.M01': 0,
  },
};

const kids = (id) => nodes.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order);

/** 課目内の中分類を配信順に並べる */
function topicsOf(subject) {
  const out = [];
  for (const large of kids(subject))
    for (const mid of kids(large.id)) {
      const w = W[subject][mid.id.slice(subject.length + 1)] ?? 1;
      out.push({ large: large.name, id: mid.id, name: mid.name, small: kids(mid.id).map((s) => s.name), w });
    }
  return out;
}

const dates = [];
for (let d = new Date(`${START}T00:00:00Z`); d <= new Date(`${END}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
const slots = [];
for (const date of dates) for (const [slot, minutes, questions] of SLOTS) if (!(date === START && slot === 'noon')) slots.push({ date, slot, minutes, questions });
const N = slots.length;
const CROSS = 3; // 最後の3枠は課目横断

// 巡ごとに先頭をずらして6課目を一巡。連続する枠は必ず別の課目になり、朝は6日で全課目に1回ずつ当たる
const subjectAt = (n) => ORDER[(n % 6 + Math.floor(n / 6)) % 6];
const assigned = {};
for (const s of ORDER) assigned[s] = [];
for (let n = 0; n < N - CROSS; n++) assigned[subjectAt(n)].push(n);

const NOTE_FIRST = 'L001（金融）で6つの係数の式の導出・期首払い・補間による利回りの逆算・インフレ／税金の調整をすでに扱った。この単元で導出を繰り返さない。係数の復習は「1分でわかる」程度にとどめ、ライフプラン上の使い方（教育資金・住宅ローンの返済額・退職後の取崩し・複数のライフイベントを重ねたキャッシュフロー）と、課目ライフ特有の論点を中心に深める。';
const NOTE_LAST = 'L001（金融）で6つの係数をすでに扱った。時間価値の後半では、前の回で扱った範囲の続きと、L001で触れていない応用（複利と単利、実効年利率、繰上返済の期間短縮・返済額軽減の比較など、ガイドの範囲で必要なもの）を扱い、係数の説明を繰り返さない。';

const plan = new Map(); // スロット番号 → 内容
const report = [];
for (const s of ORDER) {
  const idx = assigned[s];
  const ts = topicsOf(s);
  const total = idx.reduce((a, n) => a + slots[n].minutes, 0);
  const sumW = ts.reduce((a, t) => a + t.w, 0);
  let pos = 0;
  for (const t of ts) { t.start = pos; pos += (total * t.w) / sumW; t.end = pos; }
  let acc = 0;
  const cells = idx.map((n) => { const c = { n, a: acc, b: acc + slots[n].minutes, primary: null, also: [] }; acc = c.b; return c; });
  for (const c of cells) {
    const mid = (c.a + c.b) / 2;
    c.primary = ts.find((t) => t.w > 0 && t.start <= mid && mid < t.end) ?? null;
  }
  const primaries = new Set(cells.map((c) => c.primary));
  const cellAt = (p) => cells.find((c) => p <= c.b + 1e-9) ?? cells[cells.length - 1];
  for (const t of ts) {
    if (t.w > 0 && primaries.has(t)) continue;
    const p = t.w > 0 ? (t.start + t.end) / 2 : t.start;
    cellAt(p).also.push(t);
    if (t.w > 0) report.push(`${s} ${t.id} ${t.name}: 単独の枠なし（${cellAt(p).primary.name} に含める）`);
  }
  for (const c of cells) {
    const mates = cells.filter((x) => x.primary === c.primary);
    const k = mates.length, i = mates.indexOf(c) + 1;
    let note = null;
    if (c.primary.id === 'life.L02.M01') note = i === 1 ? NOTE_FIRST : NOTE_LAST;
    plan.set(c.n, {
      subject: s, large: c.primary.large, middle: c.primary.name, topicId: c.primary.id, small: c.primary.small,
      part: k > 1 ? `${i}/${k}` : null, also: c.also.map((t) => ({ id: t.id, name: t.name, small: t.small })), note,
    });
  }
}
const cross = [
  { subject: 'risk', large: '課目横断', middle: '生命保険の課税関係の総整理（所得税・相続税・贈与税・法人税）', topicId: 'risk', small: [], part: null, also: [], note: null },
  { subject: 'realestate', large: '課目横断', middle: '不動産の取得・保有・譲渡・相続の税務の総整理', topicId: 'realestate', small: [], part: '1/2', also: [], note: null },
  { subject: 'realestate', large: '課目横断', middle: '不動産の取得・保有・譲渡・相続の税務の総整理', topicId: 'realestate', small: [], part: '2/2', also: [], note: null },
];
cross.forEach((u, i) => plan.set(N - CROSS + i, u));

const prevPath = join(OUT, 'curriculum.json');
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')).lectures : [];
const delivered = new Map(prev.filter((l) => l.status === 'delivered').map((l) => [l.id, l]));

const lectures = slots.map((sl, n) => {
  const id = `L${String(n + 1).padStart(3, '0')}`;
  return { id, ...sl, ...plan.get(n), status: 'planned', title: null, ...delivered.get(id) };
});

mkdirSync(OUT, { recursive: true });
writeFileSync(prevPath, JSON.stringify({
  exam: { name: '2027年度第1回CFP資格審査試験', days: ['2027-06-13', '2027-06-20'], lawBaseDate: '2027-01-01' },
  generatedFrom: 'FP学習ガイド（2026/4/1改定）の大分類・中分類',
  lectures,
}, null, 1) + '\n');
const per = Object.fromEntries(ORDER.map((s) => [s, lectures.filter((l) => l.subject === s).length]));
console.log(`${lectures.length} 回`, per, `朝${lectures.filter((l) => l.slot === 'am').length}／昼${lectures.filter((l) => l.slot === 'noon').length}／夕${lectures.filter((l) => l.slot === 'pm').length}`);
console.log(`総分数 ${lectures.reduce((a, l) => a + l.minutes, 0)}`);
report.forEach((r) => console.log(r));
