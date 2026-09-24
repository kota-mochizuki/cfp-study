import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/store';
import { MOCK_COUNT, MOCK_MINUTES, sessionPath, startSession } from '../../app/actions';
import type { ChoiceKey, Question, Session, SubjectId } from '../../domain/types';
import { SUBJECTS, SUBJECT_MAP } from '../../domain/subjects';
import { getQuestions, getSession, logEvent, recordAnswer, saveSession, sessionAttempts } from '../../data/repo';
import { fmtClock, fmtDuration } from '../../lib/time';
import { Choices, QuestionBody, choiceOrder } from '../QuestionParts';
import { ReviewItem } from './Result';
import { Bar, Icon, PageHeader, pct } from '../components';

/** 模試の開始画面 */
export function MockStart() {
  const app = useApp();
  const nav = useNavigate();
  const [subject, setSubject] = useState<SubjectId>('finance');
  const available = app.activeMetas.filter((m) => m.subject === subject).length;
  async function start() {
    const s = await startSession(app, 'mock', { count: MOCK_COUNT, scopeNodeId: subject });
    if (s) nav(sessionPath(s));
  }
  return <main className="page">
    <PageHeader title="本番模試" back />
    <section className="card">
      <p>本番と同じ <b>{MOCK_COUNT}問・{MOCK_MINUTES}分</b>・四肢択一。回答中は正解を表示しません。</p>
      <div className="chips wrap">
        {SUBJECTS.map((s) => <button key={s.id} className={`chip ${subject === s.id ? 'on' : ''}`} onClick={() => setSubject(s.id)}>{s.short}</button>)}
      </div>
      <p className="muted">{SUBJECT_MAP[subject].name}：出題可能 {available}問
        {available < MOCK_COUNT && <><br />※問題が{MOCK_COUNT}問に満たないため、{available}問・{Math.round((MOCK_MINUTES * available) / MOCK_COUNT)}分相当で実施します（時間は本番どおり{MOCK_MINUTES}分）。</>}</p>
      <p className="footnote">電卓（演算機能のみ）を用意してください。大分類ごとの問題数に比例して抽出します。</p>
    </section>
    <footer className="thumb-bar"><button className="btn-primary btn-xl" disabled={!available} onClick={start}>模試を開始</button></footer>
  </main>;
}

export default function Mock() {
  const { id = '' } = useParams();
  const app = useApp();
  const nav = useNavigate();
  const [session, setSession] = useState<Session>();
  const [qs, setQs] = useState<Map<string, Question>>(new Map());
  const [now, setNow] = useState(Date.now());
  const [palette, setPalette] = useState(false);
  const shownAt = useRef(Date.now());
  const spent = useRef<Record<string, number>>({});

  useEffect(() => {
    getSession(id).then(async (s) => {
      if (!s) return nav('/');
      if (s.endedAt) return nav(`/mock-result/${s.id}`, { replace: true });
      setQs(await getQuestions(s.items.map((i) => i.questionId)));
      setSession(s);
    });
  }, [id, nav]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const remaining = session ? session.startedAt + (session.timeLimitMs ?? 0) - now : 0;
  const item = session?.items[session.cursor];
  const q = item ? qs.get(item.questionId) : undefined;
  const order = useMemo(() => (q ? choiceOrder(q, app.settings.shuffleChoices, id) : []), [q, app.settings.shuffleChoices, id]);

  const submitAll = useCallback(async (s: Session) => {
    const at = Date.now();
    for (const it of s.items) {
      const meta = app.metaMap.get(it.questionId);
      const qq = qs.get(it.questionId);
      if (!meta || !qq) continue;
      const a = s.answers[it.questionId];
      const selected = a?.selected ?? null;
      const r = await recordAnswer({
        question: meta, session: s, slot: it.slot, track: it.track, reason: '本番模試', selected, correct: selected === qq.correct_answer,
        timeMs: spent.current[it.questionId] ?? a?.timeMs ?? 0, at, avgTimeMs: app.avgTimeMs, intervals: app.settings.intervals,
      });
      app.putCard(r.card);
      app.addAttempt(r.attempt);
    }
    await saveSession({ ...s, endedAt: at });
    await logEvent('session_completed', { mode: 'mock', n: s.items.length });
    nav(`/mock-result/${s.id}`, { replace: true });
  }, [app, qs, nav]);

  // 時間切れで自動提出
  useEffect(() => { if (session && !session.endedAt && remaining <= 0) submitAll(session); }, [remaining <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session || !item || !q) return <main className="page"><p className="empty">読み込み中…</p></main>;

  function track() {
    const qid = item!.questionId;
    spent.current[qid] = (spent.current[qid] ?? 0) + (Date.now() - shownAt.current);
    shownAt.current = Date.now();
  }
  async function update(patch: Partial<Session>) {
    const s = { ...session!, ...patch };
    setSession(s);
    await saveSession(s);
  }
  function select(k: ChoiceKey) {
    const qid = item!.questionId;
    update({ answers: { ...session!.answers, [qid]: { selected: k, correct: k === q!.correct_answer, timeMs: spent.current[qid] ?? 0 } } });
  }
  function go(i: number) { track(); setPalette(false); update({ cursor: Math.max(0, Math.min(session!.items.length - 1, i)) }); window.scrollTo(0, 0); }
  const marked = new Set(session.marked ?? []);
  const answeredN = Object.keys(session.answers).length;

  return <main className="page player mock">
    <header className="player-top">
      <button className="icon-btn" aria-label="中断" onClick={() => { track(); nav('/'); }}><Icon name="close" /></button>
      <div className={`timer ${remaining < 10 * 60_000 ? 'low' : ''}`}>{fmtClock(remaining)}</div>
      <button className="icon-btn" aria-label="問題一覧" onClick={() => setPalette(!palette)}><Icon name="grid" /></button>
    </header>

    {palette && <section className="palette card">
      <p className="muted">回答済み {answeredN}/{session.items.length}・見直し {marked.size}</p>
      <div className="palette-grid">
        {session.items.map((it, i) => <button key={it.questionId} onClick={() => go(i)}
          className={`pal ${session.answers[it.questionId] ? 'done' : ''} ${marked.has(it.questionId) ? 'marked' : ''} ${i === session.cursor ? 'cur' : ''}`}>{i + 1}</button>)}
      </div>
      <button className="btn-primary" onClick={() => { if (confirm(`提出しますか？（未回答 ${session.items.length - answeredN}問）`)) { track(); submitAll(session); } }}>提出して採点</button>
    </section>}

    <QuestionBody q={q} topicName={app.nodeMap.get(q.topic_id)?.name ?? q.topic} lawBaseDate={app.settings.lawBaseDate} index={session.cursor + 1} total={session.items.length} />
    <Choices q={q} order={order} selected={session.answers[item.questionId]?.selected ?? null} revealed={false} onSelect={select} />

    <footer className="thumb-bar three">
      <button className="btn-secondary" disabled={session.cursor === 0} onClick={() => go(session.cursor - 1)}>前へ</button>
      <button className={`btn-secondary ${marked.has(item.questionId) ? 'on' : ''}`} onClick={() => {
        const m = new Set(marked);
        if (m.has(item.questionId)) m.delete(item.questionId); else m.add(item.questionId);
        update({ marked: [...m] });
      }}><Icon name={marked.has(item.questionId) ? 'flagFill' : 'flag'} size={18} /> 見直し</button>
      {session.cursor + 1 < session.items.length
        ? <button className="btn-primary" onClick={() => go(session.cursor + 1)}>次へ</button>
        : <button className="btn-primary" onClick={() => setPalette(true)}>提出へ</button>}
    </footer>
  </main>;
}

export function MockResult() {
  const { id = '' } = useParams();
  const app = useApp();
  const [session, setSession] = useState<Session>();
  const [qs, setQs] = useState<Map<string, Question>>(new Map());
  useEffect(() => {
    getSession(id).then(async (s) => {
      if (!s) return;
      setSession(s);
      setQs(await getQuestions(s.items.map((i) => i.questionId)));
      await sessionAttempts(id);
    });
  }, [id]);
  if (!session) return null;

  const total = session.items.length;
  const results = session.items.map((it) => ({ it, q: qs.get(it.questionId), sel: session.answers[it.questionId]?.selected ?? null }));
  const correct = results.filter((r) => r.q && r.sel === r.q.correct_answer).length;
  const pass = app.settings.passLineRatio;
  // 分野別（大分類）正答率
  const byLarge = new Map<string, { name: string; ok: number; n: number }>();
  for (const r of results) {
    if (!r.q) continue;
    let node = app.nodeMap.get(r.q.topic_id);
    while (node && node.level !== 'large' && node.parentId) node = app.nodeMap.get(node.parentId);
    const key = node?.id ?? r.q.subject;
    const g = byLarge.get(key) ?? { name: node?.name ?? '', ok: 0, n: 0 };
    g.n++; if (r.sel === r.q.correct_answer) g.ok++;
    byLarge.set(key, g);
  }
  const wrong = results.filter((r) => r.q && r.sel !== r.q.correct_answer);

  return <main className="page result">
    <PageHeader title="模試の結果" back="/" />
    <section className="card score-card">
      <div className="score"><b>{correct * 2}</b><span>点 / {total * 2}点</span></div>
      <div className="muted">正答率 {pct(correct / total)}・{correct}/{total}問・所要時間 {fmtDuration((session.endedAt ?? 0) - session.startedAt)}</div>
      <div className="passline"><Bar value={correct / total} tone={correct / total >= pass ? 'ok' : 'ng'} /><i style={{ left: `${pass * 100}%` }} /></div>
      <p className="footnote">縦線は合格目安 {pct(pass)}（過去の合格ラインは概ね50問中25〜33問）。合格を保証するものではありません。</p>
    </section>
    <section className="card">
      <h3>分野別正答率</h3>
      <ul className="kv-list">{[...byLarge.values()].sort((a, b) => a.ok / a.n - b.ok / b.n).map((g) => <li key={g.name}><span>{g.name}</span><span>{g.ok}/{g.n}（{pct(g.ok / g.n)}）</span></li>)}</ul>
    </section>
    {wrong.length > 0 && <section className="card"><h3>間違えた問題（{wrong.length}）</h3>
      {wrong.map((r) => <ReviewItem key={r.it.questionId} q={r.q!} selected={r.sel} index={session.items.indexOf(r.it) + 1} seed={session.id} />)}
    </section>}
    {session.subject && <p className="muted center">{SUBJECT_MAP[session.subject].name}</p>}
  </main>;
}
