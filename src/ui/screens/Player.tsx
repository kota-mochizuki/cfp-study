import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/store';
import type { ChoiceKey, ErrorCause, Question, Session } from '../../domain/types';
import { ERROR_CAUSES } from '../../domain/subjects';
import { followUp, insertFollowUp } from '../../engine/adaptive';
import { answerInsight } from '../../engine/insights';
import {
  getNote, getQuestions, getSession, logEvent, rateAnswer, recordAnswer, saveNote, saveSession, setFlagged, toggleFavorite, updateAttempt,
} from '../../data/repo';
import { Choices, Explanation, QuestionBody, choiceOrder } from '../QuestionParts';
import { Bar, Icon } from '../components';

interface Answered {
  correct: boolean;
  attemptId: number;
  insight: string | null;
  suggestedCause?: ErrorCause;
  /** 前回この問題で選んだ誤答（回答後にだけ表示。回答前のヒントにしない） */
  lastWrong?: ChoiceKey;
  /** 誤答の選択肢ごとの累計回数（今回を含む） */
  wrongChoices?: Partial<Record<ChoiceKey, number>>;
  revengeComplete: boolean;
}

export default function Player() {
  const { id = '' } = useParams();
  const app = useApp();
  const nav = useNavigate();
  const [session, setSession] = useState<Session>();
  const [qs, setQs] = useState<Map<string, Question>>(new Map());
  const [selected, setSelected] = useState<ChoiceKey | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [rating, setRating] = useState<1 | 2 | 3>();
  const [cause, setCause] = useState<ErrorCause>();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRef = useRef(Date.now());
  const topRef = useRef<HTMLDivElement>(null);
  const activeMap = useMemo(() => new Map(app.activeMetas.map((m) => [m.id, m])), [app.activeMetas]);

  useEffect(() => {
    getSession(id).then(async (s) => {
      if (!s) { nav('/'); return; }
      if (s.cursor >= s.items.length) { nav(`/result/${s.id}`, { replace: true }); return; }
      setQs(await getQuestions(s.items.map((i) => i.questionId)));
      setSession(s);
    });
  }, [id, nav]);

  const item = session?.items[session.cursor];
  const q = item ? qs.get(item.questionId) : undefined;
  const order = useMemo(() => (q ? choiceOrder(q, app.settings.shuffleChoices, id) : []), [q, app.settings.shuffleChoices, id]);

  // 問題が変わったら状態をリセットし、回答時間の計測を始める
  useEffect(() => {
    if (!q) return;
    setSelected(null); setAnswered(null); setShowReason(false); setRating(undefined); setCause(undefined); setNote(null);
    startRef.current = Date.now();
    topRef.current?.scrollIntoView({ block: 'start' });
  }, [q?.question_id, session?.cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(async (s: Session) => {
    const ended = { ...s, endedAt: Date.now() };
    await saveSession(ended);
    const n = Object.keys(ended.answers).length;
    if (n >= 3) {
      // 1問あたりの所要時間（解説込み）を学習して、時間→問題数の見積もりを本人に合わせる
      const measured = Math.max(20, Math.min(240, (ended.endedAt - ended.startedAt) / 1000 / n));
      await app.updateSettings({ secPerQuestion: Math.round(app.settings.secPerQuestion * 0.7 + measured * 0.3) });
    }
    await logEvent('session_completed', { mode: s.mode, n });
    nav(`/result/${s.id}`, { replace: true });
  }, [app, nav]);

  async function submit() {
    if (!session || !item || !q || !selected || busy) return;
    setBusy(true);
    const meta = app.metaMap.get(q.question_id)!;
    const timeMs = Date.now() - startRef.current;
    const correct = selected === q.correct_answer;
    const openDefault = app.prefs.openExplanation[q.question_type];
    const prev = (app.attempts ?? []).filter((a) => a.questionId === q.question_id).sort((a, b) => b.answeredAt - a.answeredAt)[0];
    const r = await recordAnswer({
      question: meta, session, slot: item.slot, track: item.track, reason: item.reason, selected, correct, timeMs, at: Date.now(),
      avgTimeMs: app.avgTimeMs, intervals: app.settings.intervals, trackExplanation: session.feedback === 'immediate' && !openDefault,
    });
    app.putCard(r.card);
    app.addAttempt(r.attempt);
    let next: Session = { ...session, answers: { ...session.answers, [q.question_id]: { selected, correct, timeMs } } };

    if (session.feedback === 'deferred') {
      next = { ...next, cursor: next.cursor + 1 };
      await saveSession(next);
      setBusy(false);
      if (next.cursor >= next.items.length) return finish(next);
      setSession(next);
      return;
    }

    const cards = new Map(app.cards).set(r.card.questionId, r.card);
    const fu = followUp(next, item, correct, activeMap, cards, app.nodeMap, Date.now());
    if (fu) {
      next = insertFollowUp(next, fu);
      const extra = await getQuestions([fu.questionId]);
      setQs((prev) => new Map([...prev, ...extra]));
    }
    await saveSession(next);
    setSession(next);
    let suggestedCause: ErrorCause | undefined;
    if (!correct) suggestedCause = r.before?.lastResult ? 'forgot' : timeMs > app.avgTimeMs * 3 ? 'time' : undefined;
    setAnswered({
      correct, attemptId: r.attempt.id!, insight: answerInsight(r.before, correct, timeMs), suggestedCause,
      lastWrong: prev && !prev.correct && prev.selected ? prev.selected : undefined,
      wrongChoices: r.card.wrongChoices, revengeComplete: correct && (r.before?.wrongCount ?? 0) > 0,
    });
    setBusy(false);
  }

  async function next() {
    if (!session) return;
    const s = { ...session, cursor: session.cursor + 1 };
    if (s.cursor >= s.items.length) return finish(s);
    await saveSession(s);
    setSession(s);
  }

  function exit() {
    if (session && Object.keys(session.answers).length < session.items.length) logEvent('session_abandoned', { mode: session.mode, n: Object.keys(session.answers).length });
    nav('/');
  }

  // PC ではキーボードでも操作できる（1〜4で選択、Enterで回答/次へ）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (!answered && /^[1-4]$/.test(e.key) && order.length) setSelected(order[Number(e.key) - 1]);
      if (e.key === 'Enter') { e.preventDefault(); if (answered) next(); else submit(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!session || !item || !q) return <main className="page player"><p className="empty">読み込み中…</p></main>;

  const topicName = app.nodeMap.get(q.topic_id)?.name ?? q.topic;
  const card = app.cards.get(q.question_id);
  const fav = app.favorites.has(q.question_id);
  const total = session.items.length;

  return <main className="page player" ref={topRef}>
    <header className="player-top">
      <button className="icon-btn" aria-label="終了" onClick={exit}><Icon name="close" /></button>
      <div className="player-progress"><Bar value={(session.cursor + (answered ? 1 : 0)) / total} thin /></div>
      <button className="icon-btn" aria-label="なぜこの問題？" aria-pressed={showReason} onClick={() => setShowReason(!showReason)}><Icon name="info" /></button>
    </header>
    {showReason && <p className="reason">{item.reason}</p>}

    <QuestionBody q={q} topicName={topicName} lawBaseDate={app.settings.lawBaseDate} index={session.cursor + 1} total={total} />
    <Choices q={q} order={order} selected={selected} revealed={!!answered} onSelect={setSelected} />

    {answered && <section className="answer">
      <Verdict answered={answered} order={order} q={q} selected={selected!} />
      {answered.insight && !answered.revengeComplete && <p className="insight">{answered.insight}</p>}

      <Explanation key={q.question_id} q={q} order={order} selected={selected} openDetail={app.prefs.openExplanation[q.question_type]}
        onOpenDetail={() => { updateAttempt(answered.attemptId, { explanationOpened: true }); app.patchAttempt(answered.attemptId, { explanationOpened: true }); }} />

      {!answered.correct && <div className="cause">
        <span className="muted">間違えた原因（任意）</span>
        <div className="chips wrap">
          {(Object.keys(ERROR_CAUSES) as ErrorCause[]).map((c) => <button key={c} className={`chip sm ${cause === c ? 'on' : ''} ${!cause && answered.suggestedCause === c ? 'hint' : ''}`}
            onClick={() => { setCause(c); updateAttempt(answered.attemptId, { errorCause: c }); }}>{ERROR_CAUSES[c]}</button>)}
        </div>
      </div>}

      <div className="post-actions">
        <div className="chips" role="radiogroup" aria-label="難しさ">
          {([[1, '簡単'], [2, '普通'], [3, '難しい']] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={rating === v} className={`chip sm ${rating === v ? 'on' : ''}`}
            onClick={async () => { setRating(v); const c = await rateAnswer(answered.attemptId, q.question_id, v, app.settings.intervals); if (c) app.putCard(c); }}>{l}</button>)}
        </div>
        <div className="tool-row">
          <button className={`tool ${card?.flagged ? 'on' : ''}`} onClick={async () => app.putCard(await setFlagged(q.question_id, !card?.flagged))}>
            <Icon name={card?.flagged ? 'flagFill' : 'flag'} size={18} />あとで復習</button>
          <button className={`tool ${fav ? 'on' : ''}`} onClick={async () => app.setFavorite(q.question_id, await toggleFavorite(q.question_id))}>
            <Icon name={fav ? 'starFill' : 'star'} size={18} />お気に入り</button>
          <button className={`tool ${note ? 'on' : ''}`} onClick={async () => setNote(note == null ? await getNote(q.question_id) : null)}>
            <Icon name="note" size={18} />メモ</button>
        </div>
        {note != null && <textarea className="note" placeholder="例：ここ毎回間違える／計算式を覚える" defaultValue={note} autoFocus
          onBlur={(e) => saveNote(q.question_id, e.target.value)} />}
      </div>
    </section>}

    <footer className="thumb-bar">
      {answered
        ? <button className="btn-primary btn-xl" onClick={next}>{session.cursor + 1 >= total ? '結果を見る' : '次へ'}</button>
        : <button className="btn-primary btn-xl" onClick={submit} disabled={!selected || busy}>{session.feedback === 'deferred' ? (session.cursor + 1 >= total ? '回答して終了' : '回答して次へ') : '回答する'}</button>}
    </footer>
  </main>;
}

/** 正解は小さく気持ちよく、誤答は「次に倒す対象ができた」へ。REVENGE 攻略は強めに */
function Verdict({ answered, order, q, selected }: { answered: Answered; order: ChoiceKey[]; q: Question; selected: ChoiceKey }) {
  const no = (k: ChoiceKey) => order.indexOf(k) + 1;
  const total = Object.values(answered.wrongChoices ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const repeats = Object.entries(answered.wrongChoices ?? {}).filter(([, n]) => (n ?? 0) >= 2) as [ChoiceKey, number][];
  if (answered.correct) return <div className={`verdict ok ${answered.revengeComplete ? 'revenge' : ''}`} role="status">
    <div className="verdict-main"><span>{answered.revengeComplete ? 'REVENGE COMPLETE ⚡' : '✓ CORRECT'}</span><span className="verdict-sub">{no(q.correct_answer)}</span></div>
    {answered.revengeComplete && answered.lastWrong && <p className="verdict-line">前回：{no(answered.lastWrong)}　→　今回：{no(q.correct_answer)} ✓</p>}
  </div>;
  return <div className="verdict ng" role="status">
    <div className="verdict-main"><span>REVENGE ADDED</span><span className="verdict-sub">明日もう一度</span></div>
    <p className="verdict-line">あなたの回答：{no(selected)}　／　正解：{no(q.correct_answer)}</p>
    {answered.lastWrong && <p className="verdict-line muted">LAST TIME あなたは {no(answered.lastWrong)} を選択しました</p>}
    {total >= 2 && <p className="verdict-line muted">この問題は{total}回間違えています。{repeats.map(([k, n]) => `${no(k)}を選択：${n}回`).join('・')}
      {repeats.length > 0 && '（この選択肢の誤解を重点復習）'}</p>}
  </div>;
}
