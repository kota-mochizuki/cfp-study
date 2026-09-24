import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/store';
import type { DevLog, Idea, WeeklyReview } from '../../domain/types';
import { MODE_LABELS } from '../../domain/subjects';
import { db } from '../../data/db';
import { studyMs } from '../../engine/activity';
import { DAY, startOfDay, startOfWeek, ymd } from '../../lib/time';
import { Collapse, Empty, PageHeader } from '../components';

/** 使われていなければ非表示・削除を検討する機能（Kill Criteria） */
const TRACKED_MODES = ['daily', 'surprise', 'challenge', 'weak', 'wrong', 'calc', 'unanswered', 'random', 'flagged', 'favorites', 'test10', 'mock', 'diagnostic', 'subject'] as const;

const fmtMin = (ms: number) => `${Math.floor(ms / 3_600_000)}時間${Math.round((ms % 3_600_000) / 60_000)}分`;

export default function Dev() {
  const app = useApp();
  const [logs, setLogs] = useState<DevLog[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [reviews, setReviews] = useState<WeeklyReview[]>([]);
  const reload = async () => {
    setLogs(await db.devLog.toArray());
    setIdeas(await db.ideas.orderBy('createdAt').reverse().toArray());
    setReviews(await db.reviews.orderBy('at').reverse().toArray());
  };
  useEffect(() => { reload(); }, []);

  const now = Date.now();
  const week0 = startOfWeek(now);
  const weekLogs = logs.filter((l) => l.at >= week0);
  const devWeek = weekLogs.filter((l) => l.kind === 'dev').reduce((a, l) => a + l.minutes, 0) * 60_000;
  const contentWeek = weekLogs.filter((l) => l.kind === 'content_work').reduce((a, l) => a + l.minutes, 0) * 60_000;
  const weekAttempts = (app.attempts ?? []).filter((a) => a.answeredAt >= week0);
  const practiceWeek = studyMs(weekAttempts);

  // ───── 開発時間ログ ─────
  const [kind, setKind] = useState<DevLog['kind']>('dev');
  const [minutes, setMinutes] = useState('30');
  const [note, setNote] = useState('');
  async function addLog() {
    const m = Number(minutes);
    if (!m) return;
    await db.devLog.add({ kind, minutes: m, note, at: Date.now() });
    setNote('');
    reload();
  }

  // ───── Idea Parking Lot ─────
  const [idea, setIdea] = useState<Omit<Idea, 'id' | 'createdAt' | 'status'>>({ idea: '', purpose: '', contribution: '', effect: '', cost: '' });
  async function park() {
    if (!idea.idea.trim()) return;
    await db.ideas.add({ ...idea, createdAt: Date.now(), status: 'parked' });
    setIdea({ idea: '', purpose: '', contribution: '', effect: '', cost: '' });
    reload();
  }
  async function evaluate(i: Idea, gate: Idea['gate']) {
    // A（合格への貢献）が低ければ実装しない。A高 かつ B or C 高 を優先
    const status: Idea['status'] = gate!.a <= 1 ? 'rejected' : gate!.a >= 2 && (gate!.b >= 3 || gate!.c >= 3) && gate!.d <= 2 ? 'approved' : 'parked';
    await db.ideas.update(i.id!, { gate, status });
    reload();
  }

  // ───── 週次レビュー ─────
  const lastReview = reviews[0];
  const reviewOpen = !lastReview || now - lastReview.at >= 6 * DAY;
  const usage = useMemo(() => {
    const since = now - 30 * DAY;
    const counts: Record<string, number> = {};
    for (const e of app.events) if (e.type === 'mode_selected' && e.at >= since) counts[String(e.payload.mode)] = (counts[String(e.payload.mode)] ?? 0) + 1;
    return counts;
  }, [app.events]); // eslint-disable-line react-hooks/exhaustive-deps
  const unused = TRACKED_MODES.filter((m) => !usage[m]);
  const [pain, setPain] = useState('');
  const [decision, setDecision] = useState('');
  async function saveReview() {
    await db.reviews.add({ at: Date.now(), weekAnswers: weekAttempts.length, pain, unused: unused.map((m) => MODE_LABELS[m]).join('、'), decision });
    setPain(''); setDecision('');
    reload();
  }

  const overBuild = devWeek > practiceWeek + contentWeek && devWeek > 0;
  const today0 = startOfDay(now);

  return <main className="page dev">
    <PageHeader title="開発者メニュー" back="/settings" />
    <p className="footnote">最優先目標は CFP 合格。ここは「作ること」が「解くこと」を侵食していないかを確かめる場所です。</p>

    <section className={`card ${overBuild ? 'alert' : ''}`}>
      <h3>今週の時間</h3>
      <ul className="kv-list">
        <li><span>問題演習（自動計測）</span><b>{fmtMin(practiceWeek)}</b></li>
        <li><span>学習コンテンツ作業（問題作成・分類・法改正確認）</span><b>{fmtMin(contentWeek)}</b></li>
        <li><span>アプリ開発</span><b>{fmtMin(devWeek)}</b></li>
      </ul>
      {overBuild && <p className="alert-msg">今週はアプリ改善 {fmtMin(devWeek)}、問題演習 {fmtMin(practiceWeek)} です。現在の最優先目標は CFP 合格です。新機能開発を続けますか？</p>}
      <div className="log-form">
        <select value={kind} onChange={(e) => setKind(e.target.value as DevLog['kind'])}><option value="dev">アプリ開発</option><option value="content_work">コンテンツ作業（学習扱い）</option></select>
        <input type="number" inputMode="numeric" min={5} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="分" /><span>分</span>
        <input placeholder="メモ" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-secondary sm" onClick={addLog}>記録</button>
      </div>
    </section>

    <section className="card">
      <h3>Idea Parking Lot</h3>
      <p className="footnote">思いついた当日は実装しない。翌日以降に Feature Gate（A 合格への貢献／B 使用頻度／C UX改善／D 開発コスト）で評価します。</p>
      <div className="form">
        <label>アイデア<input value={idea.idea} onChange={(e) => setIdea({ ...idea, idea: e.target.value })} /></label>
        <label>目的<input value={idea.purpose} onChange={(e) => setIdea({ ...idea, purpose: e.target.value })} /></label>
        <label>合格への貢献<input value={idea.contribution} onChange={(e) => setIdea({ ...idea, contribution: e.target.value })} /></label>
        <label>期待効果<input value={idea.effect} onChange={(e) => setIdea({ ...idea, effect: e.target.value })} /></label>
        <label>開発コスト<input value={idea.cost} onChange={(e) => setIdea({ ...idea, cost: e.target.value })} /></label>
        <button className="btn-secondary" onClick={park}>駐車する</button>
      </div>
      {ideas.length === 0 ? <Empty>アイデアはまだありません</Empty> : <ul className="idea-list">
        {ideas.map((i) => <li key={i.id}>
          <div className="idea-head"><b>{i.idea}</b><span className={`flag st-${i.status}`}>{{ parked: '保留', approved: '採用候補', rejected: '見送り', done: '実装済み' }[i.status]}</span></div>
          <span className="muted">{ymd(i.createdAt)}・{i.purpose}</span>
          {i.createdAt >= today0 ? <p className="footnote">今日のアイデアです。評価は明日以降に。</p> : <GateForm idea={i} onSave={(g) => evaluate(i, g)} />}
        </li>)}
      </ul>}
    </section>

    <section className="card">
      <h3>週次レビュー</h3>
      {!reviewOpen ? <p className="footnote">次回のレビューは {ymd(lastReview!.at + 7 * DAY)} 以降です。大きな仕様変更はレビュー時に判断します。</p> : <>
        <ul className="kv-list">
          <li><span>今週解いた問題</span><b>{weekAttempts.length}問</b></li>
          <li><span>30日で使った機能</span><b>{Object.entries(usage).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${MODE_LABELS[m as keyof typeof MODE_LABELS] ?? m} ${n}`).join('、') || '—'}</b></li>
          <li><span>30日使っていない機能（非表示・削除候補）</span><b>{unused.map((m) => MODE_LABELS[m]).join('、') || 'なし'}</b></li>
        </ul>
        <div className="form">
          <label>どこで不便を感じたか<textarea value={pain} onChange={(e) => setPain(e.target.value)} rows={2} /></label>
          <label>判断（追加・削除・そのまま）<textarea value={decision} onChange={(e) => setDecision(e.target.value)} rows={2} /></label>
          <button className="btn-secondary" onClick={saveReview}>レビューを保存</button>
        </div>
      </>}
      {reviews.length > 0 && <Collapse title={`過去のレビュー（${reviews.length}）`}>
        <ul className="msg-list">{reviews.map((r) => <li key={r.id}><b>{ymd(r.at)}</b> {r.weekAnswers}問／不便：{r.pain || '—'}／判断：{r.decision || '—'}</li>)}</ul>
      </Collapse>}
    </section>
  </main>;
}

function GateForm({ idea, onSave }: { idea: Idea; onSave: (g: NonNullable<Idea['gate']>) => void }) {
  const [g, setG] = useState(idea.gate ?? { a: 2, b: 2, c: 2, d: 2 });
  const row = (k: keyof typeof g, label: string) => <label className="gate-row">{label}
    <select value={g[k]} onChange={(e) => setG({ ...g, [k]: Number(e.target.value) })}>{[1, 2, 3].map((v) => <option key={v} value={v}>{['低', '中', '高'][v - 1]}</option>)}</select></label>;
  return <div className="gate">
    {row('a', 'A 合格への貢献')}{row('b', 'B 使用頻度')}{row('c', 'C UX改善')}{row('d', 'D 開発コスト')}
    <button className="btn-secondary sm" onClick={() => onSave(g)}>評価する</button>
  </div>;
}
