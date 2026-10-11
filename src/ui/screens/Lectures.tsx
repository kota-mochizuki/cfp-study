import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../../app/store';
import { SUBJECTS, SUBJECT_MAP } from '../../domain/subjects';
import type { ChoiceKey, Lecture, LectureState, LectureSummary, Question, Session, SubjectId } from '../../domain/types';
import { buildLectureReport, lectureStates, loadLecture, loadLectureIndex, patchLectureState, relatedSections, saveLectureScroll, saveLectureState } from '../../data/lectures';
import { getSession, recordAnswer, saveSession } from '../../data/repo';
import { uid } from '../../lib/random';
import { Choices, Explanation } from '../QuestionParts';
import { Empty, Icon, Markdown, PageHeader } from '../components';

const slotLabel = (l: Pick<LectureSummary, 'date' | 'slot'>) => `${l.date.replace(/^\d+-0?(\d+)-0?(\d+)$/, '$1/$2')} ${{ am: '朝', noon: '昼', pm: '夕' }[l.slot] ?? ''}`;

const isDone = (st: LectureState | undefined) => Object.keys(st?.answers ?? {}).length >= 5;

/** 講義の進み具合: 未読 / 問題の途中 / 完了 */
function progress(st: LectureState | undefined): string {
  if (!st) return '未読';
  const n = Object.keys(st.answers).length;
  return n >= 5 ? '完了' : n ? `問題 ${n}/5` : '読みかけ';
}

export function useLectureIndex() {
  const [data, setData] = useState<{ list: LectureSummary[]; offline: boolean; states: Record<string, LectureState> }>();
  useEffect(() => {
    Promise.all([loadLectureIndex(), lectureStates()]).then(([i, states]) => setData({ ...i, states }));
  }, []);
  return data;
}

export function LectureRow({ l, state }: { l: LectureSummary; state?: LectureState }) {
  return <Link to={`/lecture/${l.id}`} className="lec-row">
    <span className="lec-when">{slotLabel(l)}<b>{SUBJECT_MAP[l.subject].short}</b></span>
    <span className="lec-title">{l.title}</span>
    <span className={`lec-state ${state && Object.keys(state.answers).length >= 5 ? 'done' : ''}`}>{progress(state)}</span>
  </Link>;
}

export default function LectureList() {
  const data = useLectureIndex();
  const app = useApp();
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);
  const [subject, setSubject] = useState<'all' | SubjectId>('all');
  const [onlyPending, setOnlyPending] = useState(false);
  const shown = (data?.list ?? []).filter((l) => (subject === 'all' || l.subject === subject) && (!onlyPending || !isDone(data!.states[l.id])));
  // クリップボードが使えない環境でも、表示された文章を手で選んでコピーできるようにする
  async function makeReport() {
    const text = await buildLectureReport(app.attempts ?? []);
    setReport(text);
    setCopied(await navigator.clipboard?.writeText(text).then(() => true, () => false) ?? false);
  }
  return <main className="page">
    <PageHeader title="講義" back="/" />
    {data?.offline && <p className="footnote">通信できないため、前回までに取得した一覧を表示しています。</p>}
    {data && !data.list.length && <Empty>まだ講義が配信されていません。毎日 7:00・12:00・17:00 に追加されます。</Empty>}
    {data && data.list.length > 0 && <>
      <div className="chips" role="group" aria-label="講義の絞り込み">
        <button className={`chip sm ${subject === 'all' && !onlyPending ? 'on' : ''}`} aria-pressed={subject === 'all' && !onlyPending} onClick={() => { setSubject('all'); setOnlyPending(false); }}>すべて</button>
        <button className={`chip sm ${onlyPending ? 'on' : ''}`} aria-pressed={onlyPending} onClick={() => setOnlyPending(!onlyPending)}>未完了</button>
        {SUBJECTS.map((s) => <button key={s.id} className={`chip sm ${subject === s.id ? 'on' : ''}`} aria-pressed={subject === s.id} onClick={() => setSubject(subject === s.id ? 'all' : s.id)}>{s.short}</button>)}
      </div>
      {shown.length ? <section className="card lec-list">
        {shown.map((l) => <LectureRow key={l.id} l={l} state={data.states[l.id]} />)}
      </section> : <Empty>該当する講義はありません。</Empty>}
    </>}
    <section className="card">
      <h3>学習レポート</h3>
      <p className="footnote">確認問題の誤答をまとめます。コピーして Claude に貼ると、以後の講義と復習に反映されます（週1回が目安）。</p>
      <button className="btn-secondary" onClick={makeReport}>学習レポートをコピー</button>
      {report && <>
        <p className="footnote" role="status">{copied ? 'コピーしました。' : '下の文章を選択してコピーしてください。'}</p>
        <textarea className="lec-report" readOnly value={report} rows={8} onFocus={(e) => e.currentTarget.select()} />
      </>}
    </section>
  </main>;
}

export function LectureView() {
  const { id = '' } = useParams();
  const app = useApp();
  const [lecture, setLecture] = useState<Lecture>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [state, setState] = useState<LectureState>();
  const [error, setError] = useState('');
  const resumeY = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await loadLecture(id, app.settings.lawBaseDate);
        await app.reload();
        const st = (await lectureStates())[id] ?? { openedAt: Date.now(), answers: {} };
        await saveLectureState(id, st);
        if (!alive) return;
        resumeY.current = st.scrollY ?? 0;
        setLecture(r.lecture); setQuestions(r.questions); setState(st);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 前回読んでいた位置へ戻り、スクロールするたびに（少し待ってから）位置を保存する
  const loaded = !!lecture && !!state;
  useEffect(() => {
    if (!loaded) return;
    const y = resumeY.current;
    const restore = y > 0 ? setTimeout(() => window.scrollTo(0, y), 80) : undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => { clearTimeout(t); t = setTimeout(() => saveLectureScroll(id, window.scrollY), 500); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(restore); clearTimeout(t); window.removeEventListener('scroll', onScroll); };
  }, [loaded, id]);

  if (error) return <main className="page"><PageHeader title="講義" back="/lectures" /><Empty>{error}</Empty></main>;
  if (!lecture || !state) return <main className="page"><PageHeader title="講義" back="/lectures" /><Empty>読み込み中…</Empty></main>;

  const subject = SUBJECT_MAP[lecture.subject];
  // 本文（体系図と第3章の各節）は既定で閉じておき、読みたい所・間違えた所だけ開く
  const open = new Set(state.open ?? []);
  const allOpen = lecture.sections.every((_, i) => open.has(i + 1));
  function setOpen(next: Set<number>) {
    const arr = [...next].sort((a, b) => a - b);
    setState({ ...state!, open: arr });
    patchLectureState(id, { open: arr });
  }
  function toggle(i: number) {
    const next = new Set(open);
    if (next.has(i)) next.delete(i); else next.add(i);
    setOpen(next);
  }
  function openSection(i: number) {
    setOpen(new Set(open).add(i));
    setTimeout(() => document.getElementById(`sec-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
  return <main className="page lecture">
    <PageHeader title={`講義 ${lecture.id}`} back="/lectures" />

    <section className="card">
      <p className="lec-kicker">{slotLabel(lecture)} 配信・{subject.name}</p>
      <h2 className="lec-h">{lecture.title}</h2>
      <dl className="lec-info">
        <dt>対象単元</dt><dd>{lecture.large} ／ {lecture.middle.join('・')}</dd>
        <dt>想定学習時間</dt><dd>約{lecture.minutes}分</dd>
        <dt>法令基準日</dt><dd>{lecture.lawBaseDate}（{lecture.verifiedOn} に一次資料を確認）</dd>
      </dl>
      <h4 className="lec-sub">今回の到達目標</h4>
      <ul className="lec-goals">{lecture.goals.map((g) => <li key={g}>{g}</li>)}</ul>
    </section>

    {lecture.plain && <section className="card lec-plain">
      <h3 className="lec-chapter"><span>1分でわかる</span>つまりどういうこと？</h3>
      <Markdown text={lecture.plain} />
    </section>}

    <Chapter no={2} title="知識の体系図">
      <Fold id="sec-0" title="体系図を見る" open={open.has(0)} onToggle={() => toggle(0)}><Markdown text={lecture.map} /></Fold>
    </Chapter>

    <Chapter no={3} title="詳細な知識解説">
      <p className="footnote">見出しをタップすると開きます。全部読まなくて大丈夫です。先に下の確認問題を解いて、間違えた所から読むのがおすすめです。</p>
      {lecture.sections.map((s, i) => <Fold key={s.title} id={`sec-${i + 1}`} title={`3-${i + 1}　${s.title}`} open={open.has(i + 1)} onToggle={() => toggle(i + 1)}>
        <Markdown text={s.body} />
      </Fold>)}
      <button className="subtle-btn" onClick={() => setOpen(allOpen ? new Set(open.has(0) ? [0] : []) : new Set([...open, ...lecture.sections.map((_, i) => i + 1)]))}>{allOpen ? 'すべて閉じる' : 'すべて開く'}</button>
    </Chapter>

    <Chapter no={4} title="CFP試験で間違えやすい論点"><Markdown text={lecture.traps} /></Chapter>

    <section className="card">
      <h3 className="lec-chapter"><span>第5・6章</span>確認問題と解説</h3>
      <p className="footnote">オリジナル問題（公式過去問ではありません）。回答すると正答と全選択肢の解説が開き、結果は復習スケジュールに入ります。</p>
      {questions.map((q, i) => <LectureQuestion key={q.question_id} q={q} no={i + 1} lecture={lecture} total={questions.length}
        state={state} onState={setState} onOpenSection={openSection} />)}
    </section>

    <Chapter no={7} title="根拠資料">
      <ul className="lec-sources">
        {lecture.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>{s.note && <span className="muted">　{s.note}</span>}</li>)}
      </ul>
      {lecture.unconfirmed.length > 0 && <>
        <h4 className="lec-sub">未確認事項</h4>
        <ul className="lec-goals">{lecture.unconfirmed.map((u) => <li key={u}>{u}</li>)}</ul>
      </>}
    </Chapter>
  </main>;
}

function Chapter({ no, title, children }: { no: number; title: string; children: React.ReactNode }) {
  return <section className="card">
    <h3 className="lec-chapter"><span>第{no}章</span>{title}</h3>
    {children}
  </section>;
}

/** 開閉できる本文の1区画。見出しの一覧が目次の役目をする */
function Fold({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section id={id} className={`collapse lec-fold ${open ? 'open' : ''}`}>
    <button type="button" className="collapse-head" aria-expanded={open} onClick={onToggle}><span>{title}</span><Icon name="chevron" size={18} /></button>
    {open && <div className="collapse-body">{children}</div>}
  </section>;
}

function LectureQuestion({ q, no, total, lecture, state, onState, onOpenSection }: { q: Question; no: number; total: number; lecture: Lecture; state: LectureState; onState: (s: LectureState) => void; onOpenSection: (i: number) => void }) {
  const app = useApp();
  const answered = state.answers[q.question_id];
  const [selected, setSelected] = useState<ChoiceKey | null>(answered ?? null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const order: ChoiceKey[] = ['A', 'B', 'C', 'D'];
  const related = relatedSections(lecture, q.question_id);

  async function submit() {
    const meta = app.metaMap.get(q.question_id);
    if (!selected || !meta || busy) return;
    setBusy(true);
    const correct = selected === q.correct_answer;
    const timeMs = Date.now() - shownAt.current;
    // 講義1回分の5問を1つのセッションとして記録する
    const session: Session = (state.sessionId && await getSession(state.sessionId)) || {
      id: uid(), mode: 'single', label: `講義 ${lecture.id}`, startedAt: Date.now(), cursor: 0, feedback: 'immediate', answers: {}, inserted: 0,
      items: lecture.questions.map((r) => ({ questionId: String(r.question_id), slot: 'DISCOVERY' as const, track: 'EXPLORE' as const, reason: '講義の確認問題です' })),
    };
    const r = await recordAnswer({
      question: meta, session, slot: 'DISCOVERY', track: 'EXPLORE', reason: '講義の確認問題です', selected, correct, timeMs, at: Date.now(),
      avgTimeMs: app.avgTimeMs, intervals: app.settings.intervals,
    });
    app.putCard(r.card);
    app.addAttempt(r.attempt);
    const answers = { ...session.answers, [q.question_id]: { selected, correct, timeMs } };
    const done = Object.keys(answers).length >= total;
    await saveSession({ ...session, answers, cursor: Object.keys(answers).length, endedAt: done ? Date.now() : undefined });
    const next = { ...state, sessionId: session.id, answers: { ...state.answers, [q.question_id]: selected } };
    await patchLectureState(lecture.id, { sessionId: next.sessionId, answers: next.answers });
    onState(next);
    setBusy(false);
  }

  return <div className="lec-q">
    <p className="lec-qno">問{no}</p>
    <Markdown text={q.question_text} className="qtext" />
    <Choices q={q} order={order} selected={selected} revealed={!!answered} onSelect={setSelected} />
    {!answered && <button className="btn-primary" disabled={!selected || busy} onClick={submit}>回答する</button>}
    {answered && <>
      <p className={`lec-verdict ${answered === q.correct_answer ? 'ok' : 'ng'}`} role="status">
        {answered === q.correct_answer ? '✓ 正解' : '× 不正解'}（正解：{order.indexOf(q.correct_answer) + 1}）
      </p>
      <Explanation q={q} order={order} selected={answered} openDetail />
      {related.length > 0 && <div className={`lec-related ${answered === q.correct_answer ? '' : 'wrong'}`}>
        <p>{answered === q.correct_answer ? '関連する本文' : '間違えた所は、本文のここを読むと分かります'}</p>
        {related.map((i) => <button key={i} type="button" className="btn-secondary sm" onClick={() => onOpenSection(i)}>3-{i}　{lecture.sections[i - 1].title} を読む</button>)}
      </div>}
    </>}
  </div>;
}

/** ホームに出す「今日の講義」。未完了のうち最新の回へ1タップで進み、読みかけなら続きから開く */
export function LectureCard() {
  const data = useLectureIndex();
  if (!data?.list.length) return null;
  const pending = data.list.filter((l) => !isDone(data.states[l.id]));
  const next = pending[0];
  const resumed = (data.states[next?.id]?.scrollY ?? 0) > 200;
  const rows = (next ? pending.slice(1, 3) : data.list.slice(0, 2));
  return <section className="card">
    <div className="section-head"><h3>今日の講義</h3><Link to="/lectures" className="subtle-link">すべて<Icon name="chevron" size={14} /></Link></div>
    {next ? <Link to={`/lecture/${next.id}`} className="btn-primary btn-xl lec-next">
      <span>{resumed ? '続きから読む' : '次の講義を読む'}</span>
      <small>{slotLabel(next)}　{SUBJECT_MAP[next.subject].short}｜{next.title}</small>
    </Link> : <p className="footnote">配信済みの講義はすべて完了しています。</p>}
    {rows.length > 0 && <div className="lec-list">{rows.map((l) => <LectureRow key={l.id} l={l} state={data.states[l.id]} />)}</div>}
    {pending.length > 3 && <p className="footnote">未完了の講義があと {pending.length - 1} 回あります。遅れても全部は追わなくて大丈夫です。</p>}
  </section>;
}
