import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/store';
import { sessionPath, startSession } from '../../app/actions';
import type { Question, SessionMode, TaxNode } from '../../domain/types';
import { SUBJECTS, SUBJECT_MAP } from '../../domain/subjects';
import { searchQuestions } from '../../data/repo';
import { Bar, Empty, Icon, PageHeader, pct } from '../components';

interface ModeDef { mode: SessionMode; title: string; desc: string; count: number; group: 'auto' | 'focus' | 'test' }

const MODES: ModeDef[] = [
  { mode: 'daily', title: 'AIに任せる', desc: '復習・弱点・新規を自動で配分', count: 10, group: 'auto' },
  { mode: 'surprise', title: 'Surprise 5', desc: '何が出るかは開始まで秘密。裏で復習も混ざる', count: 5, group: 'auto' },
  { mode: 'challenge', title: 'Challenge 5', desc: '今の実力で、この5問突破できる？', count: 5, group: 'auto' },
  { mode: 'boss', title: '👑 BOSS', desc: '習熟した論点の難問に挑戦（最大3問）', count: 3, group: 'auto' },
  { mode: 'weak', title: '苦手攻略', desc: '苦手論点・誤答の多い問題から', count: 10, group: 'focus' },
  { mode: 'wrong', title: '🔥 REVENGE', desc: '間違えた問題にリベンジ。同じ誤答を繰り返す問題を優先', count: 20, group: 'focus' },
  { mode: 'calc', title: '計算特訓', desc: '計算問題だけを反復', count: 10, group: 'focus' },
  { mode: 'unanswered', title: '未回答', desc: 'まだ一度も解いていない問題', count: 10, group: 'focus' },
  { mode: 'random', title: 'ランダム', desc: '全範囲からランダム', count: 10, group: 'focus' },
  { mode: 'flagged', title: 'あとで復習', desc: '自分で登録した問題', count: 30, group: 'focus' },
  { mode: 'favorites', title: 'お気に入り', desc: '☆を付けた問題', count: 30, group: 'focus' },
  { mode: 'test10', title: '10問テスト', desc: '連続10問、最後にまとめて採点', count: 10, group: 'test' },
  { mode: 'diagnostic', title: '実力診断', desc: '6課目から12問。初期の習熟度に使う（任意）', count: 12, group: 'test' },
];

export default function Practice() {
  const app = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [msg, setMsg] = useState('');

  async function go(m: ModeDef) {
    const s = await startSession(app, m.mode, { count: m.count });
    if (s) nav(sessionPath(s));
    else setMsg(m.mode === 'boss'
      ? 'BOSSはまだ出現していません。同じ論点を3問以上解いて習熟度が60%を超えると、その論点の難問がBOSSとして現れます'
      : `「${m.title}」の対象問題がまだありません`);
  }
  useEffect(() => { if (params.get('diag')) go(MODES.find((m) => m.mode === 'diagnostic')!); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const section = (group: ModeDef['group'], title: string) => <section>
    <h3 className="group-title">{title}</h3>
    <div className="mode-grid">
      {MODES.filter((m) => m.group === group).map((m) => <button key={m.mode} className={`mode-card mode-${m.mode}`} onClick={() => go(m)}>
        <b>{m.title}</b><span>{m.desc}</span>
      </button>)}
      {group === 'test' && <Link to="/mock" className="mode-card mode-mock"><b>本番模試</b><span>50問・120分・本番形式</span></Link>}
    </div>
  </section>;

  return <main className="page">
    <PageHeader title="選べる学習" right={<Link to="/search" className="icon-btn" aria-label="検索"><Icon name="search" /></Link>} />
    {msg && <p className="toast" onClick={() => setMsg('')}>{msg}</p>}
    {section('auto', 'おまかせ')}
    <section>
      <h3 className="group-title">科目別</h3>
      <div className="subject-grid">
        {SUBJECTS.map((s) => <Link key={s.id} to={`/practice/subject/${s.id}`} className="subject-tile">
          <span>{s.short}</span><small>{pct(app.stats.get(s.id)?.progress ?? 0)}</small>
        </Link>)}
      </div>
    </section>
    {section('focus', '集中して')}
    {section('test', 'テスト')}
  </main>;
}

/** 課目 → 大 → 中 → 小 → 論点 と絞り込み、その範囲を解く */
export function ScopePicker() {
  const { nodeId = '' } = useParams();
  const app = useApp();
  const nav = useNavigate();
  const node = app.nodeMap.get(nodeId);
  const children = useMemo(() => app.nodes.filter((n) => n.parentId === nodeId && (app.stats.get(n.id)?.total ?? 0) > 0).sort((a, b) => a.order - b.order), [app.nodes, app.stats, nodeId]);
  const st = app.stats.get(nodeId);
  if (!node) return <main className="page"><PageHeader title="見つかりません" back /></main>;
  const path: TaxNode[] = [];
  for (let cur: TaxNode | undefined = node; cur; cur = cur.parentId ? app.nodeMap.get(cur.parentId) : undefined) path.unshift(cur);

  async function go(mode: SessionMode, count: number) {
    const s = await startSession(app, mode, { count, scopeNodeId: nodeId, label: `${node!.level === 'subject' ? SUBJECT_MAP[node!.id as keyof typeof SUBJECT_MAP].short : node!.name}` });
    if (s) nav(sessionPath(s));
  }

  return <main className="page">
    <PageHeader title={node.level === 'subject' ? SUBJECT_MAP[node.id as keyof typeof SUBJECT_MAP].name : node.name} back />
    {path.length > 1 && <nav className="crumbs">{path.slice(0, -1).map((p) => <Link key={p.id} to={`/practice/subject/${p.id}`}>{p.level === 'subject' ? SUBJECT_MAP[p.id as keyof typeof SUBJECT_MAP].short : p.name}</Link>)}</nav>}
    <section className="card">
      <div className="scope-stats">
        <div><b>{pct(st?.mastery)}</b><span>習熟度（回答済み）</span></div>
        <div><b>{st?.answered ?? 0}/{st?.total ?? 0}</b><span>回答済み問題</span></div>
        <div><b>{st?.due ?? 0}</b><span>復習待ち</span></div>
      </div>
      {st?.total ? <div className="btn-row">
        <button className="btn-primary" onClick={() => go('subject', 10)}>この範囲を10問</button>
        <button className="btn-secondary" onClick={() => go('subject', 30)}>30問</button>
        <button className="btn-secondary" onClick={() => go('random', 10)}>ランダム</button>
      </div> : <Empty>この範囲の問題はまだありません</Empty>}
    </section>
    {children.length > 0 && <ul className="tree-list">
      {children.map((c) => {
        const s = app.stats.get(c.id)!;
        return <li key={c.id}><Link to={`/practice/subject/${c.id}`} className="tree-row">
          <span className="tree-name">{c.name}</span>
          <span className="tree-meta">{s.answered}/{s.total}問</span>
          <span className="tree-bar"><Bar value={s.mastery ?? 0} thin tone={s.mastery == null ? 'muted' : s.mastery < 0.6 ? 'ng' : 'primary'} /></span>
          <Icon name="chevron" size={16} />
        </Link></li>;
      })}
    </ul>}
  </main>;
}

export function Search() {
  const app = useApp();
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Question[] | null>(null);
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const t = setTimeout(() => searchQuestions(query, app.nodeMap).then(setResults), 200);
    return () => clearTimeout(t);
  }, [query, app.nodeMap]);

  async function solve(ids: string[], label: string) {
    const s = await startSession(app, ids.length === 1 ? 'single' : 'random', { count: ids.length, questionIds: ids, label });
    if (s) nav(sessionPath(s));
  }

  return <main className="page">
    <PageHeader title="検索" back />
    <input className="search-input" type="search" autoFocus placeholder="例：住宅ローン控除、遺族年金、PER、相続時精算課税" value={query} onChange={(e) => setQuery(e.target.value)} />
    {results && (results.length === 0 ? <Empty>該当する問題がありません</Empty> : <>
      <div className="section-head"><span className="muted">{results.length}件{results.length >= 100 ? '以上' : ''}</span>
        <button className="btn-secondary sm" onClick={() => solve(results.map((q) => q.question_id).slice(0, 30), `検索：${query}`)}>まとめて解く</button></div>
      <ul className="result-list">
        {results.map((q) => <li key={q.question_id}><button onClick={() => solve([q.question_id], app.nodeMap.get(q.topic_id)?.name ?? q.topic)}>
          <span className="muted">{SUBJECT_MAP[q.subject].short}・{app.nodeMap.get(q.topic_id)?.name ?? q.topic}</span>
          <span className="result-text">{q.question_text.replace(/\|.*$/gms, '').slice(0, 80)}…</span>
        </button></li>)}
      </ul>
    </>)}
  </main>;
}
