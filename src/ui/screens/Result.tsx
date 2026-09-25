import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/store';
import { sessionPath, startSession } from '../../app/actions';
import type { Attempt, Question, Session, SubjectId } from '../../domain/types';
import { SUBJECTS, SUBJECT_MAP } from '../../domain/subjects';
import { getQuestions, getSession, sessionAttempts } from '../../data/repo';
import { fmtDuration } from '../../lib/time';
import { Choices, Explanation, QuestionBody, choiceOrder } from '../QuestionParts';
import { Collapse, PageHeader, pct } from '../components';

export function ReviewItem({ q, selected, index, seed }: { q: Question; selected: Attempt['selected']; index: number; seed: string }) {
  const app = useApp();
  const order = choiceOrder(q, app.settings.shuffleChoices, seed);
  const ok = selected === q.correct_answer;
  return <Collapse className="review-item" title={<><span className={`rv-mark ${ok ? 'ok' : 'ng'}`}>{ok ? '○' : '×'}</span>{index}. {app.nodeMap.get(q.topic_id)?.name ?? q.topic}</>}>
    <QuestionBody q={q} topicName={app.nodeMap.get(q.topic_id)?.name ?? q.topic} lawBaseDate={app.settings.lawBaseDate} />
    <Choices q={q} order={order} selected={selected} revealed />
    {!selected && <p className="muted">未回答</p>}
    <Explanation q={q} order={order} selected={selected} openDetail />
  </Collapse>;
}

export default function Result() {
  const { id = '' } = useParams();
  const app = useApp();
  const nav = useNavigate();
  const [session, setSession] = useState<Session>();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [qs, setQs] = useState<Map<string, Question>>(new Map());

  useEffect(() => {
    (async () => {
      const s = await getSession(id);
      if (!s) return nav('/');
      setSession(s);
      setAttempts(await sessionAttempts(id));
      setQs(await getQuestions(s.items.map((i) => i.questionId)));
    })();
  }, [id, nav]);

  // 実力診断: 課目別の結果を初期習熟度（事前値）として保存
  const diag = useMemo(() => {
    if (session?.mode !== 'diagnostic') return null;
    const r: Partial<Record<SubjectId, { ok: number; n: number }>> = {};
    for (const a of attempts) { const x = (r[a.subject] ??= { ok: 0, n: 0 }); x.n++; if (a.correct) x.ok++; }
    return r;
  }, [session, attempts]);
  useEffect(() => {
    if (!diag || app.settings.diagnosticDone || !Object.keys(diag).length) return;
    const priors = Object.fromEntries(Object.entries(diag).map(([k, v]) => [k, (v!.ok + 1) / (v!.n + 2)]));
    app.updateSettings({ priors, diagnosticDone: true });
  }, [diag]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;
  const answered = attempts.length;
  const correct = attempts.filter((a) => a.correct).length;
  const topicName = (a: Attempt) => app.nodeMap.get(a.topicId)?.name ?? '';
  const overcame = [...new Set(attempts.filter((a) => a.correct && a.wrongCountBefore > 0).map(topicName))];
  const followOk = [...new Set(attempts.filter((a) => a.correct && session.items.find((i) => i.questionId === a.questionId)?.followStage).map(topicName))];
  const learned = [...new Set(attempts.filter((a) => a.correct && a.wrongCountBefore === 0 && a.streakBefore === 0).map(topicName))].filter((t) => !overcame.includes(t));
  const understood = [...new Set([...overcame, ...followOk])];
  const wrongs = attempts.filter((a) => !a.correct);
  const duration = (session.endedAt ?? Date.now()) - session.startedAt;

  async function more() {
    const s = await startSession(app, 'daily', { count: 5, timeBudgetMin: 5 });
    if (s) nav(sessionPath(s), { replace: true });
  }

  return <main className="page result">
    <PageHeader title={session.label} back="/" />
    <section className="card score-card">
      <div className="score"><b>{correct}</b><span>/ {answered}問 正解</span></div>
      <div className="muted">{pct(answered ? correct / answered : 0)}・{fmtDuration(duration)}</div>
    </section>

    {diag && <section className="card">
      <h3>実力診断の結果</h3>
      <ul className="kv-list">{SUBJECTS.filter((s) => diag[s.id]).map((s) => <li key={s.id}><span>{s.short}</span><span>{diag[s.id]!.ok}/{diag[s.id]!.n}</span></li>)}</ul>
      <p className="footnote">この結果を各課目の初期習熟度として使います。回答が増えるほど実データに置き換わります。</p>
    </section>}

    {(understood.length > 0 || learned.length > 0) && <section className="card">
      {understood.length > 0 && <><h3>今日理解したこと</h3><ul className="check-list">{understood.map((t) => <li key={t}>✓ {t}</li>)}</ul></>}
      {learned.length > 0 && <><h3 className={understood.length ? 'mt' : ''}>新しく習得した論点</h3><ul className="check-list">{learned.map((t) => <li key={t}>＋ {t}</li>)}</ul></>}
    </section>}

    {session.feedback === 'deferred'
      ? <section className="card"><h3>全問の振り返り</h3>
          {session.items.map((it, i) => qs.get(it.questionId) && <ReviewItem key={it.questionId} q={qs.get(it.questionId)!} selected={session.answers[it.questionId]?.selected ?? null} index={i + 1} seed={session.id} />)}
        </section>
      : wrongs.length > 0 && <section className="card"><h3>間違えた問題（{wrongs.length}）</h3>
          <p className="footnote">翌日の「今日の最適学習」に自動で入ります。</p>
          {wrongs.map((a, i) => qs.get(a.questionId) && <ReviewItem key={a.id} q={qs.get(a.questionId)!} selected={a.selected} index={i + 1} seed={session.id} />)}
        </section>}

    {session.subject && <p className="muted center">{SUBJECT_MAP[session.subject].name}</p>}
    <footer className="thumb-bar two">
      <button className="btn-secondary btn-xl" onClick={() => nav('/')}>ホームへ</button>
      <button className="btn-primary btn-xl" onClick={more}>もう5問</button>
    </footer>
  </main>;
}
