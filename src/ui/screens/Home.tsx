import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../app/store';
import { buildContext, sessionPath, startSession } from '../../app/actions';
import { SUBJECTS } from '../../domain/subjects';
import type { Session } from '../../domain/types';
import { TIME_BUDGETS, buildSession, countForMinutes } from '../../engine/sessionBuilder';
import { activity } from '../../engine/activity';
import { growth } from '../../engine/insights';
import { activeSession, logEvent } from '../../data/repo';
import { daysBetween, fmtDuration, parseYmd } from '../../lib/time';
import { Bar, Icon, pct } from '../components';

export default function Home() {
  const app = useApp();
  const nav = useNavigate();
  const { settings, prefs } = app;
  const [minutes, setMinutes] = useState(prefs.preferredMinutes ?? settings.defaultMinutes);
  const [resume, setResume] = useState<Session>();
  const [starting, setStarting] = useState(false);

  useEffect(() => { activeSession().then(setResume); }, []);

  const count = countForMinutes(minutes, settings.secPerQuestion);
  // 表示した計画をそのまま開始する（プレビューと実際の出題を一致させる）
  const plan = useMemo(() => buildSession(buildContext(app), { mode: 'daily', count }), [app.cards, app.activeMetas, count]); // eslint-disable-line react-hooks/exhaustive-deps
  const estMin = Math.max(1, Math.round((plan.items.length * settings.secPerQuestion) / 60));
  const daysLeft = settings.examDate ? daysBetween(Date.now(), parseYmd(settings.examDate)) : null;
  const act = app.attempts ? activity(app.attempts, Date.now()) : null;
  const weekly = useMemo(() => (app.attempts && app.attempts.length >= 5
    ? growth({ nodes: app.nodes, metas: app.activeMetas, attempts: app.attempts, cards: app.cards, now: Date.now(), avgTimeMs: app.avgTimeMs, priors: settings.priors, intervals: settings.intervals })
    : null), [app.attempts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (starting) return;
    setStarting(true);
    const s = await startSession(app, 'daily', { count, plan, timeBudgetMin: minutes });
    setStarting(false);
    if (s) nav(sessionPath(s));
  }

  const mission = [
    { label: '復習・弱点', n: plan.counts.CORE, tone: 'core' },
    { label: 'チャレンジ', n: plan.counts.CHALLENGE, tone: 'challenge' },
    { label: '新規論点', n: plan.counts.DISCOVERY, tone: 'discovery' },
    { label: 'Surprise', n: plan.counts.SURPRISE, tone: 'surprise' },
  ].filter((m) => m.n > 0);

  return <main className="page home">
    <header className="home-top">
      <span className="countdown">{daysLeft != null && daysLeft >= 0 ? <>試験まであと <b>{daysLeft}</b> 日</> : 'CFP Study'}</span>
      <Link to="/search" className="icon-btn" aria-label="検索"><Icon name="search" /></Link>
    </header>

    {resume && <button className="resume" onClick={() => nav(sessionPath(resume))}>
      <span>続きから：{resume.label}</span>
      <span className="muted">{resume.cursor}/{resume.items.length} <Icon name="chevron" size={16} /></span>
    </button>}

    <section className="card hero">
      <div className="hero-head">
        <h2>今日の最適学習</h2>
        <div className="hero-count"><b>{plan.items.length}</b>問<span className="muted">・約{estMin}分</span></div>
      </div>
      {!settings.simpleHome && mission.length > 0 && <ul className="mission">
        {mission.map((m) => <li key={m.label}><i className={`dot dot-${m.tone}`} />{m.label}<b>{m.n}</b></li>)}
      </ul>}
      <div className="chips" role="radiogroup" aria-label="学習時間">
        {TIME_BUDGETS.map((t) => <button key={t.min} role="radio" aria-checked={minutes === t.min} className={`chip ${minutes === t.min ? 'on' : ''}`}
          onClick={() => { setMinutes(t.min); logEvent('time_selected', { min: t.min }); }}>{t.label}</button>)}
      </div>
      <button className="btn-primary btn-xl" onClick={start} disabled={!plan.items.length || starting}>学習を始める</button>
      {!settings.diagnosticDone && (app.attempts?.length ?? 0) < 20 && <Link className="subtle-link" to="/practice?diag=1">初めての方へ：実力診断（任意・12問）で初期の習熟度を設定</Link>}
    </section>

    <section className="card">
      <div className="section-head"><h3>6課目の習熟度</h3><Link to="/analysis" className="subtle-link">詳しく</Link></div>
      <ul className="subject-bars">
        {SUBJECTS.map((s) => {
          const st = app.stats.get(s.id);
          return <li key={s.id}>
            <Link to={`/practice/subject/${s.id}`} className="subject-row">
              <span className="subject-name">{s.short}</span>
              <Bar value={st?.progress ?? 0} />
              <span className="subject-pct">{pct(st?.progress ?? 0)}</span>
            </Link>
            {!!st?.due && <span className="due-badge" title="復習待ち">{st.due}</span>}
          </li>;
        })}
      </ul>
      <p className="footnote">習熟度＝回答の質（最近ほど重視・忘却補正）× 範囲のカバー。未回答の問題は0として数えます。</p>
    </section>

    {weekly && (weekly.items.length > 0 || weekly.weakBefore !== weekly.weakAfter) && <section className="card">
      <div className="section-head"><h3>今週の成長</h3><Link to="/analysis" className="subtle-link">すべて</Link></div>
      <ul className="growth-list">
        {weekly.items.slice(0, 3).map((g) => <li key={g.id}><span>{g.name}</span><span className="growth-num">{pct(g.before)} → <b>{pct(g.after)}</b></span></li>)}
        {weekly.weakBefore !== weekly.weakAfter && <li><span>苦手論点</span><span className="growth-num">{weekly.weakBefore} → <b>{weekly.weakAfter}</b></span></li>}
      </ul>
    </section>}

    {act && <section className="card stats-grid">
      <div><span className="stat-num">{act.today}</span><span className="stat-label">今日の回答</span></div>
      <div><span className="stat-num">{act.week}</span><span className="stat-label">今週の回答</span></div>
      <div><span className="stat-num">{act.streak}<small>日</small></span><span className="stat-label">連続学習</span></div>
      <div><span className="stat-num">{act.total}</span><span className="stat-label">総回答数</span></div>
      <div><span className="stat-num">{pct(act.accuracy)}</span><span className="stat-label">正答率</span></div>
      <div><span className="stat-num">{fmtDuration(act.studyMs).replace(/\d+秒$/, '') || '0分'}</span><span className="stat-label">学習時間</span></div>
    </section>}
  </main>;
}
