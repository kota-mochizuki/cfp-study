// 今回の実行で作る回を決める。  node tools/progress.mjs
// 学習者のアプリが公開している「講義ごとの回答数」を読み、まだ解き終えていない講義（夜間作成の回）が
// TARGET 本より少なければ、次の回を1本作る。解いた本数だけ翌晩に補充される。
// 完了状況が読めないとき（通信不可・未ログイン）は、配信日が今日以前の回だけを作る（1日6本の予定どおり）。
import { readFileSync } from 'node:fs';

const TARGET = 6;
const PROGRESS_URL = 'https://firestore.googleapis.com/v1/projects/cfp-study-1b5a8/databases/(default)/documents/progress';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const cur = read('lectures/curriculum.json');
const index = read('lectures/index.json');
const early = read('lectures/early.json');
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // 日本時間

/** 回答数（講義id → 回答した確認問題の数）。読めなければ null */
async function answered() {
  try {
    const res = await fetch(PROGRESS_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const docs = (await res.json()).documents ?? [];
    if (!docs.length) return null;
    docs.sort((a, b) => (a.fields.updatedAt?.timestampValue ?? '') < (b.fields.updatedAt?.timestampValue ?? '') ? 1 : -1);
    return { map: JSON.parse(docs[0].fields.json.stringValue).answered ?? {}, updatedAt: docs[0].fields.updatedAt?.timestampValue ?? null };
  } catch { return null; }
}

const planned = cur.lectures.filter((l) => l.status === 'planned');
const night = index.filter((l) => l.slot === 'night');
const nextR = `R${String(index.filter((l) => l.id.startsWith('R')).length + 1).padStart(3, '0')}`;
const examOver = today > cur.exam.days[1];
const out = { today, target: TARGET, source: null, outstanding: null, make: null, reason: '' };

const prog = await answered();
if (examOver) out.reason = '試験が終了しているので作らない';
else if (early.length) { out.make = early[0]; out.reason = '前倒しの依頼（early.json）'; }
else if (prog) {
  out.source = `完了状況（${prog.updatedAt} 更新）`;
  const open = night.filter((l) => (prog.map[l.id] ?? 0) < 3).map((l) => l.id);
  out.outstanding = open.length;
  if (open.length >= TARGET) out.reason = `解き終えていない講義が${open.length}本ある（${open.slice(0, 8).join(' ')}）ので作らない`;
  else { out.make = planned[0]?.id ?? nextR; out.reason = `解き終えていない講義は${open.length}本。${TARGET}本になるまで作る`; }
} else {
  out.source = '完了状況を読めない → 日付で判断';
  const due = planned.find((l) => l.date <= today);
  const rToday = index.filter((l) => l.id.startsWith('R') && l.date === today).length;
  if (due) { out.make = due.id; out.reason = `配信日 ${due.date} の回が未作成`; }
  else if (!planned.length && rToday < TARGET) { out.make = nextR; out.reason = `今日の総復習は${rToday}本`; }
  else out.reason = '今日の分まで配信済み';
}
console.log(JSON.stringify(out, null, 1));
console.log(out.make ? `→ 担当回は ${out.make}（1本だけ作る）` : '→ 今回は何も作らない');
