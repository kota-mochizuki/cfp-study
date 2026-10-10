// 配信講義の全体カリキュラム（lectures/curriculum.json）を論点マスタから生成する。
// 2026-10-11〜2027-04-30 の毎日 朝7時・夕方17時 = 404回。6課目×67回＋最終日の横断2回。
// 既に配信済み（status=delivered）の回は書き換えない。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const nodes = JSON.parse(readFileSync('src/data/seed/taxonomy.json', 'utf8'));
const ORDER = ['finance', 'realestate', 'life', 'risk', 'tax', 'inheritance'];
const START = '2026-10-11';
const END = '2027-04-30';

/**
 * 中分類ごとの講義回数。書いていない中分類は 1 回。
 * 0 = 単独の回を作らず、直前の回（課目の先頭なら直後の回）に含める。
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

const byId = new Map(nodes.map((n) => [n.id, n]));
const kids = (id) => nodes.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order);

/** 課目ごとの講義単位（配信順） */
function units(subject) {
  const out = [];
  let pending = [];
  for (const large of kids(subject)) {
    for (const mid of kids(large.id)) {
      const key = mid.id.slice(subject.length + 1);
      const w = W[subject][key] ?? 1;
      const topic = { id: mid.id, name: mid.name, small: kids(mid.id).map((s) => s.name) };
      if (w === 0) {
        if (out.length) out[out.length - 1].also.push(topic); else pending.push(topic);
        continue;
      }
      for (let p = 1; p <= w; p++) {
        out.push({ subject, large: large.name, middle: mid.name, topicId: mid.id, small: topic.small, part: w > 1 ? `${p}/${w}` : null, also: p === 1 ? pending : [] });
        if (p === 1) pending = [];
      }
    }
  }
  return out;
}

const dates = [];
for (let d = new Date(`${START}T00:00:00Z`); d <= new Date(`${END}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));

const queues = Object.fromEntries(ORDER.map((s) => [s, units(s)]));
for (const s of ORDER) if (queues[s].length !== 67) throw new Error(`${s}: ${queues[s].length} 回（67回に調整してください）`);

const prev = existsSync('lectures/curriculum.json') ? JSON.parse(readFileSync('lectures/curriculum.json', 'utf8')).lectures : [];
const delivered = new Map(prev.filter((l) => l.status === 'delivered').map((l) => [l.id, l]));

const lectures = [];
for (let n = 0; n < dates.length * 2; n++) {
  const id = `L${String(n + 1).padStart(3, '0')}`;
  const base = { id, date: dates[n >> 1], slot: n % 2 ? 'pm' : 'am' };
  let u;
  if (n < 402) {
    // 6回で6課目を一巡。巡ごとに先頭をずらし、同じ課目が朝・夕に偏らないようにする
    u = queues[ORDER[(n % 6 + Math.floor(n / 6)) % 6]].shift();
  } else {
    u = n === 402
      ? { subject: 'risk', large: '課目横断', middle: '生命保険の課税関係の総整理（所得税・相続税・贈与税・法人税）', topicId: 'risk', small: [], part: null, also: [] }
      : { subject: 'realestate', large: '課目横断', middle: '不動産の取得・保有・譲渡・相続の税務の総整理', topicId: 'realestate', small: [], part: null, also: [] };
  }
  lectures.push(delivered.get(id) ?? { ...base, ...u, status: 'planned', title: null, note: null });
}

mkdirSync('lectures', { recursive: true });
writeFileSync('lectures/curriculum.json', JSON.stringify({
  exam: { name: '2027年度第1回CFP資格審査試験', days: ['2027-06-13', '2027-06-20'], lawBaseDate: '2027-01-01' },
  generatedFrom: 'FP学習ガイド（2026/4/1改定）の大分類・中分類',
  lectures,
}, null, 1) + '\n');
const per = Object.fromEntries(ORDER.map((s) => [s, lectures.filter((l) => l.subject === s).length]));
console.log(`${lectures.length} 回`, per);
