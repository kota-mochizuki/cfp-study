// 講義 JSON を検証し、一覧（index.json）とカリキュラム（curriculum.json）に反映する。
//   node tools/publish.mjs L001
// 検証に1つでも失敗したら何も書き換えずに終了コード1で終わる。
import { readFileSync, writeFileSync } from 'node:fs';

const id = process.argv[2];
if (!/^[LR]\d{3}$/.test(id ?? '')) { console.error('使い方: node tools/publish.mjs L001'); process.exit(1); }

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const cur = read('lectures/curriculum.json');
const lec = read(`lectures/${id}.json`);
const errors = [];
const need = (ok, msg) => { if (!ok) errors.push(msg); };
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const guide = read('tools/guide_taxonomy.json');
const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\s/g, '');
const guideChildren = (parent) => guide.filter((n) => n.parentId === parent);
const findMiddle = (subject, large, middle) => {
  const L = guideChildren(subject).filter((n) => !large || norm(n.name) === norm(large));
  return L.flatMap((l) => guideChildren(l.id)).find((m) => norm(m.name) === norm(middle));
};
// 配信枠ごとの基準。朝=30分・確認問題5問、昼・夕=15分・確認問題3問
const SHORT = { label: '昼・夕', minutes: [12, 20], q: 3, body: [2500, 5500], plain: [200, 700], sections: 3, goals: 2, spread: 2 };
const SLOT = { am: { label: '朝', minutes: [25, 40], q: 5, body: [5000, 10500], plain: [300, 900], sections: 4, goals: 3, spread: 3 }, noon: SHORT, pm: SHORT };
const cfg = SLOT[lec.slot] ?? SLOT.am;
const SUBJECTS = ['finance', 'realestate', 'life', 'risk', 'tax', 'inheritance'];

need(lec.id === id, 'id がファイル名と一致しません');
need(/^\d{4}-\d{2}-\d{2}$/.test(lec.date ?? ''), 'date は YYYY-MM-DD');
need(!!SLOT[lec.slot], 'slot は am / noon / pm');
need(SUBJECTS.includes(lec.subject), 'subject が不正です');
need(text(lec.title) && lec.title.length <= 60, 'title は60字以内で必須');
need(Number.isInteger(lec.minutes) && lec.minutes >= cfg.minutes[0] && lec.minutes <= cfg.minutes[1], `minutes は${cfg.label}の枠では${cfg.minutes[0]}〜${cfg.minutes[1]}の整数（朝30分・昼夕15分を目安に、確認問題を解く時間を含めた分数）`);
need(text(lec.large), 'large（大分類）が必要です');
need(Array.isArray(lec.middle) && lec.middle.length > 0 && lec.middle.every(text), 'middle（中分類の配列）が必要です');
need(Array.isArray(lec.goals) && lec.goals.length >= cfg.goals, `goals（到達目標）は${cfg.goals}つ以上`);
need(text(lec.plain) && lec.plain.length >= cfg.plain[0] && lec.plain.length <= cfg.plain[1], `plain（1分でわかる：つまりどういうこと？）は${cfg.plain[0]}〜${cfg.plain[1]}字で必須です（現在 ${String(lec.plain ?? '').length} 字）`);
need(!/^#{1,4}\s/m.test(lec.plain ?? ''), 'plain に見出しは使えません（太字と表で構成してください）');
need(text(lec.map) && lec.map.includes('```'), 'map（体系図）は ``` で囲んだ階層図を含めてください');
need(Array.isArray(lec.sections) && lec.sections.length >= cfg.sections && lec.sections.every((s) => text(s.title) && text(s.body)), `sections は${cfg.sections}節以上、各節に title と body`);
need(text(lec.traps), 'traps（間違えやすい論点）が必要です');
need(lec.lawBaseDate === cur.exam.lawBaseDate, `lawBaseDate は ${cur.exam.lawBaseDate}`);
need(/^\d{4}-\d{2}-\d{2}$/.test(lec.verifiedOn ?? ''), 'verifiedOn（一次資料の確認日）が必要です');
need(Array.isArray(lec.unconfirmed), 'unconfirmed（未確認事項の配列。無ければ空配列）が必要です');
need(Array.isArray(lec.sources) && lec.sources.length >= 2 && lec.sources.every((s) => text(s.name) && /^https:\/\/\S+$/.test(s.url ?? '')), 'sources は2件以上、各件に name と https の url');

const body = [lec.map, lec.traps, ...(lec.sections ?? []).map((s) => s.body)].join('\n');
need(body.length >= cfg.body[0], `本文が短すぎます（${body.length}字。${cfg.label}の枠は${cfg.body[0]}字以上）`);
need(body.length <= cfg.body[1], `本文が長すぎます（${body.length}字。${cfg.label}の枠は${cfg.body[1]}字まで。読む時間が枠を超えます。範囲を絞り、残りは次の回の note に回してください）`);
need(body.includes('|---') || (cfg !== SLOT.am && body.includes('```')), cfg === SLOT.am ? '本文に表が1つもありません' : '本文に表も数式ブロック（```）もありません');
// アプリの Markdown が解釈できない記法
need(!/^#{1,2}\s/m.test(body), '見出しは ### と #### だけが使えます');
need(!/^\s*\d+\.\s/m.test(body), '番号付きリスト（1. ）は使えません。「- 手順1：」のように書いてください');
need(!/\$[^$\n]+\$|\\frac|\\times/.test(body), 'LaTeX は使えません。数式は ``` で囲んで書いてください');

const qs = lec.questions ?? [];
need(Array.isArray(qs) && qs.length === cfg.q, `確認問題は${cfg.label}の枠では${cfg.q}問`);
const answers = [];
qs.forEach((q, i) => {
  const n = `問${i + 1}`;
  need(q.question_id === `LEC-${id}-Q${i + 1}`, `${n}: question_id は LEC-${id}-Q${i + 1}`);
  need(q.subject === lec.subject || SUBJECTS.includes(q.subject), `${n}: subject が不正です`);
  for (const k of ['question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'explanation', 'explanation_short', 'explanation_a', 'explanation_b', 'explanation_c', 'explanation_d', 'key_point', 'category_large', 'category_middle', 'topic'])
    need(text(q[k]), `${n}: ${k} が必要です`);
  const choices = ['a', 'b', 'c', 'd'].map((k) => String(q[`choice_${k}`] ?? '').normalize('NFKC'));
  need(new Set(choices).size === 4, `${n}: 同じ内容の選択肢があります`);
  need(['A', 'B', 'C', 'D'].includes(q.correct_answer), `${n}: correct_answer は A〜D`);
  need(q.verified_answer === q.correct_answer && q.verification_status === 'verified', `${n}: 解き直した答え（verified_answer）が correct_answer と一致し、verification_status が verified であること`);
  for (const k of ['a', 'b', 'c', 'd']) need(/^[○×]\s/.test(q[`explanation_${k}`] ?? ''), `${n}: explanation_${k} は「○ 」か「× 」で始めてください`);
  need(q.source_type === 'original', `${n}: source_type は original`);
  need(q.law_reference_date === cur.exam.lawBaseDate, `${n}: law_reference_date は ${cur.exam.lawBaseDate}`);
  need(['verified', 'needs_check'].includes(q.law_revision_flag), `${n}: law_revision_flag は verified / needs_check`);
  need(['knowledge', 'calculation', 'case', 'reading'].includes(q.question_type), `${n}: question_type が不正です`);
  need(Number.isInteger(q.difficulty) && q.difficulty >= 3 && q.difficulty <= 5, `${n}: difficulty は3〜5（CFPの応用〜難問）`);
  if (q.question_type === 'calculation') need(Array.isArray(q.calculation_steps) && q.calculation_steps.length >= 2, `${n}: 計算問題には calculation_steps（2段階以上）が必要です`);
  need(Array.isArray(q.related_sections) && q.related_sections.length >= 1 && q.related_sections.length <= 3 && q.related_sections.every((x) => Number.isInteger(x) && x >= 1 && x <= (lec.sections ?? []).length), `${n}: related_sections（この問題を解くのに読むべき第3章の節番号。1始まりで1〜3個、最も関係の深い順）が必要です`);
  need(String(q.tags ?? '').includes(id), `${n}: tags に「講義;${id}」を入れてください`);
  answers.push(q.correct_answer);
});
need(new Set(answers).size >= cfg.spread, `正解番号が偏っています（${cfg.q}問で${cfg.spread}種類以上に散らしてください）`);
if (!qs.some((q) => q.question_type === 'calculation')) console.warn('注意: 計算問題がありません（計算要素のない単元であれば問題ありません）');

const cls = lec.classification;
need(Array.isArray(cls) && cls.length === cfg.q, `classification（確認問題ごとの課目の確認記録）が${cfg.q}件必要です`);
qs.forEach((q, i) => {
  const n = `問${i + 1}`;
  need(!!findMiddle(q.subject, q.category_large, q.category_middle), `${n}: 課目「${q.subject}」の学習ガイドに 大分類「${q.category_large}」／中分類「${q.category_middle}」がありません（tools/guide_taxonomy.json の名称と完全に一致させてください）`);
  need(norm(q.topic) === norm(q.category_middle), `${n}: topic は中分類名と同じにしてください`);
  const c = (cls ?? []).find((x) => x.question_id === q.question_id);
  need(!!c, `${n}: classification に ${q.question_id} がありません`);
  if (!c) return;
  for (const k of ['first', 'second']) need(c[k] && SUBJECTS.includes(c[k].subject) && text(c[k].middle) && [...guide].some((g) => g.level === 'middle' && g.id.startsWith(`${c[k].subject}.`) && norm(g.name) === norm(c[k].middle)), `${n}: classification.${k}（subject と guide にある中分類名）が不正です`);
  need(c.final && c.final.subject === q.subject && norm(c.final.large) === norm(q.category_large) && norm(c.final.middle) === norm(q.category_middle), `${n}: classification.final が問題の subject・大分類・中分類と一致しません`);
  need(text(c.reason) && c.reason.length >= 40, `${n}: classification.reason（判断の根拠。1回目と2回目の判定が食い違ったときは、どう決めたか）が40字以上必要です`);
  const same = c.first?.subject === c.final?.subject && norm(c.first?.middle) === norm(c.final?.middle) && c.second?.subject === c.final?.subject && norm(c.second?.middle) === norm(c.final?.middle);
  if (!same) console.warn(`確認: ${n} は1回目・2回目・最終の分類が一致していません。reason に決めた理由が書かれているか確認してください`);
});

const slotOf = cur.lectures.find((l) => l.id === id);
if (id.startsWith('L')) {
  need(!!slotOf, 'curriculum.json にこの id がありません');
  if (slotOf) need(slotOf.date === lec.date && slotOf.slot === lec.slot && slotOf.subject === lec.subject, 'date / slot / subject がカリキュラムと一致しません');
}

if (errors.length) { console.error(`${id}: 検証エラー ${errors.length} 件\n- ${errors.join('\n- ')}`); process.exit(1); }

const index = read('lectures/index.json').filter((l) => l.id !== id);
index.push({ id, date: lec.date, slot: lec.slot, subject: lec.subject, title: lec.title, minutes: lec.minutes });
index.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync('lectures/index.json', JSON.stringify(index, null, 1) + '\n');
if (slotOf) { slotOf.status = 'delivered'; slotOf.title = lec.title; }
writeFileSync('lectures/curriculum.json', JSON.stringify(cur, null, 1) + '\n');
console.log(`${id} を公開対象にしました（本文 ${body.length} 字・配信済み ${index.length} 回）`);
