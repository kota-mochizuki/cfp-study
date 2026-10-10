import type { Attempt, Lecture, LectureState, LectureSummary, Question } from '../domain/types';
import { CHOICE_KEYS, SUBJECTS } from '../domain/subjects';
import { ymd } from '../lib/time';
import { db } from './db';
import { commitImport, validateRows } from './importer';

/**
 * 配信講義。本文はアプリに同梱せず、リポジトリの lectures/ から取得する
 * （毎日2回の追加でアプリを再ビルドしなくて済むようにするため）。
 * 一度開いた講義は端末に保存し、電波がなくても読める。
 */
export const LECTURE_BASE = 'https://raw.githubusercontent.com/kota-mochizuki/cfp-study/lectures/lectures';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${LECTURE_BASE}/${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`講義データを取得できません（${res.status}）`);
  return res.json() as Promise<T>;
}

const kvGet = async <T>(key: string): Promise<T | undefined> => (await db.kv.get(key))?.value as T | undefined;

/** 配信済み講義の一覧（新しい順）。取得できなければ前回保存した一覧を返す */
export async function loadLectureIndex(): Promise<{ list: LectureSummary[]; offline: boolean }> {
  try {
    const list = await fetchJson<LectureSummary[]>('index.json');
    await db.kv.put({ key: 'lectureIndex', value: list });
    return { list: sortLectures(list), offline: false };
  } catch {
    return { list: sortLectures((await kvGet<LectureSummary[]>('lectureIndex')) ?? []), offline: true };
  }
}

export const sortLectures = (list: LectureSummary[]) => [...list].sort((a, b) => b.id.localeCompare(a.id));

/** 講義本文。確認問題は通常のインポート経路で問題DBに入れ、復習（SRS）・分析の対象にする */
export async function loadLecture(id: string, lawBaseDate: string): Promise<{ lecture: Lecture; questions: Question[] }> {
  let lecture: Lecture | undefined;
  try {
    lecture = await fetchJson<Lecture>(`${id}.json`);
    await db.kv.put({ key: `lecture:${id}`, value: lecture });
  } catch (e) {
    lecture = await kvGet<Lecture>(`lecture:${id}`);
    if (!lecture) throw e;
  }
  const [nodes, ids] = await Promise.all([db.nodes.toArray(), db.qmeta.toCollection().primaryKeys()]);
  const preview = validateRows(lecture.questions, [], nodes, new Set(ids), lawBaseDate);
  // 配信後に訂正が入ることがあるので上書き（回答履歴は残る）
  await commitImport(preview, 'overwrite');
  const qs = preview.results.map((r) => r.question).filter((q): q is Question => !!q);
  return { lecture, questions: qs };
}

export const lectureStates = async () => (await kvGet<Record<string, LectureState>>('lectureStates')) ?? {};

export async function saveLectureState(id: string, state: LectureState) {
  await db.kv.put({ key: 'lectureStates', value: { ...(await lectureStates()), [id]: state } });
}

/**
 * 講義の確認問題の結果をまとめた文章。講義を作る側（クラウド）は端末の記録を読めないので、
 * これをコピーして渡してもらい、以後の講義・復習に反映する。
 */
export async function buildLectureReport(attempts: Attempt[], now = Date.now()): Promise<string> {
  const mine = attempts.filter((a) => a.questionId.startsWith('LEC-')).sort((a, b) => a.answeredAt - b.answeredAt);
  const byQ = new Map<string, Attempt[]>();
  for (const a of mine) byQ.set(a.questionId, [...(byQ.get(a.questionId) ?? []), a]);
  const missed = [...byQ.entries()].filter(([, xs]) => xs.some((a) => !a.correct));
  const qs = new Map((await db.questions.bulkGet(missed.map(([id]) => id))).filter((q): q is Question => !!q).map((q) => [q.question_id, q]));
  const no = (k: Attempt['selected']) => (k ? CHOICE_KEYS.indexOf(k) + 1 : '未回答');
  const lines = [
    `CFP講義 学習レポート（${ymd(now)} 作成）`,
    `回答した確認問題 ${byQ.size}問・うち初回正解 ${[...byQ.values()].filter((xs) => xs[0].correct).length}問`,
    '',
    '■ 課目別（初回の正答数／回答数）',
    ...SUBJECTS.map((s) => {
      const firsts = [...byQ.values()].map((xs) => xs[0]).filter((a) => a.subject === s.id);
      return `${s.short} ${firsts.filter((a) => a.correct).length}/${firsts.length}`;
    }),
    '',
    '■ 間違えた問題',
    ...(missed.length ? missed.map(([id, xs]) => {
      const q = qs.get(id);
      const wrong = xs.filter((a) => !a.correct);
      const last = xs[xs.length - 1];
      return `- ${id}｜${q?.category_middle ?? q?.topic ?? ''}｜選んだ答え ${wrong.map((a) => no(a.selected)).join('→')}・正解 ${q ? no(q.correct_answer) : '?'}｜誤答${wrong.length}回・直近は${last.correct ? '正解' : '不正解'}`;
    }) : ['なし']),
  ];
  return lines.join('\n');
}
