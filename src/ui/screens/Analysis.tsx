import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../app/store';
import { sessionPath, startSession } from '../../app/actions';
import type { Session, TaxNode } from '../../domain/types';
import { SUBJECTS, SUBJECT_MAP } from '../../domain/subjects';
import { PROFILE_MIN_ANSWERS, growth, profile, readiness } from '../../engine/insights';
import { nodePath, weakest } from '../../engine/mastery';
import { completedMocks } from '../../data/repo';
import { Bar, Empty, Icon, PageHeader, pct } from '../components';

export default function Analysis() {
  const app = useApp();
  const nav = useNavigate();
  const [mocks, setMocks] = useState<Session[]>([]);
  useEffect(() => { completedMocks().then(setMocks); }, []);
  const now = Date.now();
  const attempts = app.attempts ?? [];

  const ready = useMemo(() => SUBJECTS.map((s) => readiness(s.id, app.stats, attempts, app.cards, app.metaMap, mocks, now)), [app.stats, attempts, mocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const weak = useMemo(() => weakest(app.stats, app.activeMetas, 5), [app.stats, app.activeMetas]);
  const g = useMemo(() => (attempts.length ? growth({ nodes: app.nodes, metas: app.activeMetas, attempts, cards: app.cards, now, avgTimeMs: app.avgTimeMs, priors: app.settings.priors, intervals: app.settings.intervals }) : null), [attempts]); // eslint-disable-line react-hooks/exhaustive-deps
  const prof = useMemo(() => profile(app.nodes, app.activeMetas, attempts, app.cards, now, app.avgTimeMs, app.settings.priors), [attempts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function drill(nodeId: string, label: string) {
    const s = await startSession(app, 'subject', { count: 10, scopeNodeId: nodeId, label });
    if (s) nav(sessionPath(s));
  }

  return <main className="page analysis">
    <PageHeader title="分析" />

    <section className="card">
      <h3>My CFP Profile</h3>
      {!prof.ready ? <Empty>あと {prof.remaining}問 回答すると作成されます（{PROFILE_MIN_ANSWERS}問〜）</Empty> : <dl className="profile">
        {prof.strong.length > 0 && <><dt>得意</dt><dd>{prof.strong.map((s) => SUBJECT_MAP[s].name).join('・')}</dd></>}
        {prof.stable.length > 0 && <><dt>安定</dt><dd>{prof.stable.map((s) => SUBJECT_MAP[s].name).join('・')}</dd></>}
        {prof.growing.length > 0 && <><dt>伸びている</dt><dd>{prof.growing.map((s) => SUBJECT_MAP[s].name).join('・')}</dd></>}
        {prof.focus.length > 0 && <><dt>重点強化</dt><dd>{prof.focus.map((f) => `${SUBJECT_MAP[f.subject].short}：${f.name}`).join(' ／ ')}</dd></>}
        {prof.traits.length > 0 && <><dt>学習特性</dt><dd><ul>{prof.traits.map((t) => <li key={t}>{t}</li>)}</ul></dd></>}
      </dl>}
    </section>

    <section className="card">
      <h3>本番準備度</h3>
      <p className="footnote">合格確率ではなく、準備の状態を5つの指標で示します。</p>
      <div className="ready-table" role="table">
        <div className="rt-row rt-head" role="row"><span>課目</span><span>直近正答</span><span>模試</span><span>カバー</span><span>苦手</span><span>復習</span></div>
        {ready.map((r) => <div key={r.subject} className="rt-row" role="row">
          <span>{SUBJECT_MAP[r.subject].short}</span>
          <span className={tone(r.recentAccuracy, app.settings.passLineRatio)}>{pct(r.recentAccuracy)}</span>
          <span className={tone(r.mockScore, app.settings.passLineRatio)}>{r.mockScore == null ? '—' : `${Math.round(r.mockScore * 100)}点`}</span>
          <span>{pct(r.coverage)}</span>
          <span>{r.weakTopics}</span>
          <span>{pct(r.reviewCompletion)}</span>
        </div>)}
      </div>
      <p className="footnote">直近正答＝14日間／模試＝最新（100点換算）／カバー＝回答済み論点の割合／苦手＝習熟度60%未満の論点数／復習＝期限内に解いた割合</p>
    </section>

    <section className="card">
      <h3>弱点TOP5</h3>
      {weak.length === 0 ? <Empty>まだ弱点は見つかっていません</Empty> : <ol className="weak-list">
        {weak.map((w) => {
          const path = nodePath(app.nodeMap, w.id);
          return <li key={w.id}>
            <div><b>{path.at(-1)?.name}</b><span className="muted">{SUBJECT_MAP[path[0].id as keyof typeof SUBJECT_MAP]?.short}・{path.slice(1, -1).map((p) => p.name).join(' › ')}</span></div>
            <span className="weak-pct">{pct(w.mastery)}</span>
            <button className="btn-secondary sm" onClick={() => drill(path.length > 2 ? path[path.length - 2].id : w.id, path.at(-1)!.name)}>解く</button>
          </li>;
        })}
      </ol>}
    </section>

    {g && <section className="card">
      <h3>今週の成長</h3>
      <ul className="growth-list">
        {g.items.map((it) => <li key={it.id}><span>{it.name}</span><span className="growth-num">{pct(it.before)} → <b>{pct(it.after)}</b></span></li>)}
        <li><span>苦手論点</span><span className="growth-num">{g.weakBefore} → <b>{g.weakAfter}</b></span></li>
        <li><span>新規習得（80%以上）</span><span className="growth-num"><b>+{g.newlyMastered}</b>論点</span></li>
        <li><span>今週の回答</span><span className="growth-num"><b>{g.answersThisWeek}</b>問</span></li>
      </ul>
    </section>}

    <section className="card">
      <h3>論点ツリー</h3>
      <p className="footnote">課目 → 大分類 → 中分類 → 小分類 → 論点。バーは回答済み問題の習熟度。</p>
      {SUBJECTS.map((s) => <TreeNode key={s.id} node={app.nodeMap.get(s.id)!} depth={0} />)}
    </section>
  </main>;
}

const tone = (v: number | null, pass: number) => (v == null ? '' : v >= pass + 0.1 ? 'good' : v >= pass ? '' : 'bad');

function TreeNode({ node, depth }: { node: TaxNode; depth: number }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const st = app.stats.get(node.id);
  if (!st?.total) return null;
  const kids = app.nodes.filter((n) => n.parentId === node.id && (app.stats.get(n.id)?.total ?? 0) > 0).sort((a, b) => a.order - b.order);
  const name = node.level === 'subject' ? SUBJECT_MAP[node.id as keyof typeof SUBJECT_MAP].name : node.name;
  return <div className="tnode" style={{ paddingLeft: depth ? 12 : 0 }}>
    <button className="tnode-row" onClick={() => kids.length && setOpen(!open)} aria-expanded={kids.length ? open : undefined}>
      <span className={`tnode-caret ${kids.length ? '' : 'leaf'} ${open ? 'open' : ''}`}><Icon name="chevron" size={14} /></span>
      <span className="tnode-name">{name}</span>
      <span className="tnode-bar"><Bar value={st.mastery ?? 0} thin tone={st.mastery == null ? 'muted' : st.mastery < 0.6 ? 'ng' : 'primary'} /></span>
      <span className="tnode-pct">{pct(st.mastery)}</span>
    </button>
    {open && kids.map((k) => <TreeNode key={k.id} node={k} depth={depth + 1} />)}
    {open && !kids.length && <Link className="subtle-link" to={`/practice/subject/${node.id}`}>この論点を解く</Link>}
  </div>;
}
