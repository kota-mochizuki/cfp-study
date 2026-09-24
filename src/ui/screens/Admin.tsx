import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/store';
import { sessionPath, startSession } from '../../app/actions';
import type { LawFlag, Question, QuestionStatus, SourceType, SubjectId } from '../../domain/types';
import { LAW_FLAGS, QUESTION_TYPES, SOURCE_TYPES, SUBJECTS, SUBJECT_MAP } from '../../domain/subjects';
import { db } from '../../data/db';
import { commitImport, csvTemplate, parseFile, previewImport, toCsv, type ImportPreview } from '../../data/importer';
import { deleteQuestion, getQuestion, getQuestions, saveQuestion, searchQuestions } from '../../data/repo';
import { TaxonomyIndex } from '../../data/taxonomy';
import { ALL_COLUMNS, validateRow } from '../../data/validate';
import { SAMPLE_QUESTIONS } from '../../data/seed/sampleQuestions';
import { ymd } from '../../lib/time';
import { isIOS, isStandalone } from '../../lib/device';
import { Empty, Icon, PageHeader } from '../components';
import { download } from './Settings';

const PAGE = 50;

interface Filters { subject: '' | SubjectId; large: string; year: string; source: '' | SourceType; difficulty: string; flag: '' | LawFlag; oldLaw: boolean; status: '' | QuestionStatus; q: string }
const EMPTY: Filters = { subject: '', large: '', year: '', source: '', difficulty: '', flag: '', oldLaw: false, status: '', q: '' };

export default function AdminList() {
  const app = useApp();
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Question[]>([]);
  const [textHits, setTextHits] = useState<Set<string> | null>(null);
  const set = (p: Partial<Filters>) => { setF({ ...f, ...p }); setPage(0); };

  useEffect(() => {
    if (!f.q.trim()) { setTextHits(null); return; }
    const t = setTimeout(() => searchQuestions(f.q, app.nodeMap, 10_000).then((qs) => setTextHits(new Set(qs.map((q) => q.question_id)))), 250);
    return () => clearTimeout(t);
  }, [f.q, app.nodeMap]);

  const larges = useMemo(() => app.nodes.filter((n) => n.level === 'large' && n.parentId === f.subject && (app.stats.get(n.id)?.total ?? 0) > 0), [app.nodes, app.stats, f.subject]);
  const years = useMemo(() => [...new Set(app.metas.map((m) => m.year).filter(Boolean))].sort(), [app.metas]);
  const filtered = useMemo(() => app.metas.filter((m) => {
    if (f.subject && m.subject !== f.subject) return false;
    if (f.large) { let id: string | null | undefined = m.topicId; let hit = false; while (id) { if (id === f.large) { hit = true; break; } id = app.nodeMap.get(id)?.parentId; } if (!hit) return false; }
    if (f.year && String(m.year) !== f.year) return false;
    if (f.source && m.source !== f.source) return false;
    if (f.difficulty && String(m.difficulty) !== f.difficulty) return false;
    if (f.flag && m.lawFlag !== f.flag) return false;
    if (f.oldLaw && m.lawDate >= app.settings.lawBaseDate) return false;
    if (f.status && m.status !== f.status) return false;
    if (textHits && !textHits.has(m.id)) return false;
    return true;
  }).sort((a, b) => a.id.localeCompare(b.id)), [app.metas, f, textHits, app.nodeMap, app.settings.lawBaseDate]);

  useEffect(() => {
    const ids = filtered.slice(page * PAGE, (page + 1) * PAGE).map((m) => m.id);
    getQuestions(ids).then((m) => setRows(ids.map((id) => m.get(id)!).filter(Boolean)));
  }, [filtered, page]);

  async function exportFiltered(kind: 'csv' | 'json') {
    const all = await getQuestions(filtered.map((m) => m.id));
    const qs = [...all.values()];
    if (kind === 'csv') download(`questions-${ymd(Date.now())}.csv`, '﻿' + toCsv(qs), 'text/csv');
    else {
      const groups = await db.caseGroups.bulkGet([...new Set(qs.map((q) => q.case_group_id).filter(Boolean) as string[])]);
      download(`questions-${ymd(Date.now())}.json`, JSON.stringify({ questions: qs, case_groups: groups.filter(Boolean) }, null, 1));
    }
  }

  const pages = Math.ceil(filtered.length / PAGE);
  return <main className="page admin">
    <PageHeader title="問題管理" back="/settings" right={<Link to="/admin/new" className="icon-btn" aria-label="問題を追加">＋</Link>} />
    <section className="card filters">
      <input type="search" placeholder="キーワード（問題文・論点・解説）" value={f.q} onChange={(e) => set({ q: e.target.value })} />
      <div className="filter-grid">
        <select value={f.subject} onChange={(e) => set({ subject: e.target.value as Filters['subject'], large: '' })}><option value="">課目：すべて</option>{SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.short}</option>)}</select>
        <select value={f.large} disabled={!f.subject} onChange={(e) => set({ large: e.target.value })}><option value="">分野：すべて</option>{larges.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
        <select value={f.year} onChange={(e) => set({ year: e.target.value })}><option value="">年度：すべて</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select value={f.source} onChange={(e) => set({ source: e.target.value as Filters['source'] })}><option value="">出典：すべて</option>{Object.entries(SOURCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value })}><option value="">難易度：すべて</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>難易度{d}</option>)}</select>
        <select value={f.flag} onChange={(e) => set({ flag: e.target.value as Filters['flag'] })}><option value="">法改正：すべて</option>{Object.entries(LAW_FLAGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })}><option value="">状態：すべて</option><option value="active">公開</option><option value="draft">下書き</option><option value="archived">アーカイブ</option></select>
        <label className="check"><input type="checkbox" checked={f.oldLaw} onChange={(e) => set({ oldLaw: e.target.checked })} />基準日 {app.settings.lawBaseDate} より古い</label>
      </div>
      <div className="section-head"><span className="muted">{filtered.length}問</span>
        <span className="btn-row"><button className="btn-secondary sm" onClick={() => exportFiltered('csv')}>CSV出力</button><button className="btn-secondary sm" onClick={() => exportFiltered('json')}>JSON出力</button><Link className="btn-secondary sm" to="/admin/import">インポート</Link></span></div>
    </section>
    {rows.length === 0 ? <Empty>該当する問題がありません</Empty> : <ul className="admin-list">
      {rows.map((q) => <li key={q.question_id}><Link to={`/admin/q/${encodeURIComponent(q.question_id)}`}>
        <div className="admin-row-head"><code>{q.question_id}</code><span className={`flag flag-${q.law_revision_flag}`}>{LAW_FLAGS[q.law_revision_flag]}</span>{q.status !== 'active' && <span className="flag">{q.status}</span>}</div>
        <span className="muted">{SUBJECT_MAP[q.subject].short}・{app.nodeMap.get(q.topic_id)?.name ?? q.topic}・{SOURCE_TYPES[q.source_type]}{q.source_year ? ` ${q.source_year}` : ''}・難{q.difficulty}・{q.law_reference_date}</span>
        <span className="admin-text">{q.question_text.slice(0, 70)}</span>
      </Link></li>)}
    </ul>}
    {pages > 1 && <div className="pager"><button className="btn-secondary sm" disabled={!page} onClick={() => setPage(page - 1)}>前</button><span>{page + 1}/{pages}</span><button className="btn-secondary sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>次</button></div>}
  </main>;
}

type Form = Record<(typeof ALL_COLUMNS)[number], string>;
const toForm = (q?: Question): Form => Object.fromEntries(ALL_COLUMNS.map((c) => {
  const v = q?.[c as keyof Question];
  return [c, Array.isArray(v) ? v.join(';') : v == null ? '' : String(v)];
})) as Form;

export function AdminEdit() {
  const { id } = useParams();
  const app = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState<Form>(() => ({ ...toForm(), subject: 'finance', correct_answer: 'A', difficulty: '3', importance: '2', frequency: '2', question_type: 'knowledge', source_type: 'original', law_reference_date: app.settings.lawBaseDate, law_revision_flag: 'verified', status: 'active' }));
  const [orig, setOrig] = useState<Question>();
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const isNew = !id;

  useEffect(() => {
    if (!id) return;
    getQuestion(id).then(async (q) => {
      if (!q) return;
      setOrig(q);
      const f = toForm(q);
      if (q.case_group_id) { const g = await db.caseGroups.get(q.case_group_id); if (g) { f.case_title = g.title; f.case_text = g.case_text; } }
      setForm(f);
    });
  }, [id]);

  const upd = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const suggestions = (parentName: 'subject' | 'category_large' | 'category_middle') => {
    const idx = new TaxonomyIndex(app.nodes);
    let parent = form.subject;
    if (parentName !== 'subject') parent = idx.resolve(form.subject as SubjectId, form.category_large, parentName === 'category_middle' ? form.category_middle : undefined);
    return app.nodes.filter((n) => n.parentId === parent).map((n) => n.name);
  };

  async function save() {
    const idx = new TaxonomyIndex(app.nodes);
    const existing = new Set(app.metas.map((m) => m.id).filter((x) => x !== orig?.question_id));
    const r = validateRow(form, 1, { taxonomy: idx, existingIds: existing, lawBaseDate: app.settings.lawBaseDate }, new Set());
    setErrors(r.errors); setWarnings(r.warnings);
    if (!r.question) return;
    if (r.exists) { setErrors([`question_id「${form.question_id}」は既に使われています`]); return; }
    if (idx.created.length) await db.nodes.bulkPut(idx.created);
    if (r.caseGroup) await db.caseGroups.put(r.caseGroup);
    await saveQuestion({ ...r.question, created_at: orig?.created_at ?? r.question.created_at });
    if (orig && orig.question_id !== r.question.question_id) await deleteQuestion(orig.question_id);
    await app.reload();
    nav('/admin', { replace: true });
  }
  async function remove() {
    if (!orig || !confirm(`${orig.question_id} を削除します。回答履歴は残ります。よろしいですか？`)) return;
    await deleteQuestion(orig.question_id);
    await app.reload();
    nav('/admin', { replace: true });
  }
  async function trySolve() {
    if (!orig) return;
    const s = await startSession(app, 'single', { count: 1, questionIds: [orig.question_id], label: '問題の確認' });
    if (s) nav(sessionPath(s));
  }

  const field = (k: keyof Form, label: string, opts: { area?: boolean; list?: string[]; hint?: string } = {}) => <label>
    {label}
    {opts.area ? <textarea value={form[k]} onChange={upd(k)} rows={k === 'question_text' || k === 'explanation' || k === 'case_text' ? 5 : 2} />
      : <input value={form[k]} onChange={upd(k)} list={opts.list ? `dl-${k}` : undefined} />}
    {opts.list && <datalist id={`dl-${k}`}>{opts.list.map((v) => <option key={v} value={v} />)}</datalist>}
    {opts.hint && <small>{opts.hint}</small>}
  </label>;
  const select = (k: keyof Form, label: string, options: [string, string][]) => <label>{label}
    <select value={form[k]} onChange={upd(k)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;

  return <main className="page admin-edit">
    <PageHeader title={isNew ? '問題を追加' : '問題を編集'} back="/admin" />
    {errors.length > 0 && <ul className="msg-list err">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    {warnings.length > 0 && <ul className="msg-list warn">{warnings.map((e) => <li key={e}>{e}</li>)}</ul>}
    <section className="card form">
      <h3>分類</h3>
      {field('question_id', 'question_id（一意）', { hint: '例：ORIG-TAX-0010 / PAST-2026-1-05-012' })}
      {select('subject', '課目', SUBJECTS.map((s) => [s.id, s.name]))}
      {field('category_large', '大分類', { list: suggestions('subject') })}
      {field('category_middle', '中分類', { list: suggestions('category_large') })}
      {field('category_small', '小分類', { list: suggestions('category_middle') })}
      {field('topic', '論点')}
    </section>
    <section className="card form">
      <h3>問題</h3>
      {field('case_group_id', '共通事例ID（大問）', { hint: '同じIDの問題は事例文を共有します' })}
      {form.case_group_id && <>{field('case_title', '事例タイトル')}{field('case_text', '事例文（Markdown・表可）', { area: true })}</>}
      {field('question_text', '問題文（Markdown・表可）', { area: true })}
      {(['a', 'b', 'c', 'd'] as const).map((k, i) => <div key={k}>{field(`choice_${k}`, `選択肢${i + 1}`, { area: true })}</div>)}
      {select('correct_answer', '正解', [['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']])}
    </section>
    <section className="card form">
      <h3>解説</h3>
      {field('key_point', 'この問題のポイント（1〜3行）', { area: true })}
      {field('explanation', '解説', { area: true })}
      {(['a', 'b', 'c', 'd'] as const).map((k, i) => <div key={k}>{field(`explanation_${k}`, `選択肢${i + 1}の解説`, { area: true })}</div>)}
      {field('related_topics', '関連論点（;区切り）')}
      {field('tags', 'タグ（;区切り）')}
    </section>
    <section className="card form grid2">
      <h3>属性</h3>
      {select('difficulty', '難易度', [1, 2, 3, 4, 5].map((d) => [String(d), String(d)]))}
      {select('importance', '重要度', [['1', '1 低'], ['2', '2 中'], ['3', '3 高']])}
      {select('frequency', '出題頻度', [['1', '1 低'], ['2', '2 中'], ['3', '3 高']])}
      {select('question_type', '問題形式', Object.entries(QUESTION_TYPES))}
      {select('status', '状態', [['active', '公開'], ['draft', '下書き'], ['archived', 'アーカイブ']])}
    </section>
    <section className="card form grid2">
      <h3>出典・法令</h3>
      {select('source_type', '出典', Object.entries(SOURCE_TYPES))}
      {field('source_year', '年度')}
      {field('source_exam', '回（1/2）')}
      {field('source_question_number', '問題番号')}
      {field('law_reference_date', '法令基準日（YYYY-MM-DD）')}
      {select('law_revision_flag', '法改正確認', Object.entries(LAW_FLAGS))}
    </section>
    <section className="card form">
      <h3>類題用（任意）</h3>
      {field('parent_question_id', '元問題ID')}
      {field('calc_method', '計算方法（類題で維持する核）', { area: true })}
      {field('variant_spec', '変更可能な条件（数字・人物・条件・問い方）', { area: true })}
    </section>
    <footer className="thumb-bar three">
      {orig ? <button className="btn-danger" onClick={remove}>削除</button> : <span />}
      {orig ? <button className="btn-secondary" onClick={trySolve}>解いてみる</button> : <span />}
      <button className="btn-primary" onClick={save}>保存</button>
    </footer>
  </main>;
}

export function AdminImport() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview>();
  const [onExisting, setOnExisting] = useState<'overwrite' | 'skip'>('skip');
  const [progress, setProgress] = useState<string>('');
  const [done, setDone] = useState<number | null>(null);

  /** 複数ファイルをまとめて検証（過去問を回ごと・課目ごとのファイルで一括取り込みできる） */
  async function load(files: File[]) {
    setName(files.length === 1 ? files[0].name : `${files.length}ファイル`); setDone(null); setPreview(undefined);
    setProgress(`読み込み・検証中…（${(files.reduce((a, f) => a + f.size, 0) / 1e6).toFixed(1)}MB）`);
    const rows = [], groups = [], errs: string[] = [];
    for (const f of files) {
      const r = parseFile(await f.text(), f.name);
      rows.push(...r.rows); groups.push(...r.caseGroups);
      errs.push(...r.parseErrors.map((e) => (files.length > 1 ? `${f.name}: ${e}` : e)));
    }
    setParseErrors(errs);
    setPreview(await previewImport(rows, groups, app.settings.lawBaseDate));
    setProgress('');
  }
  async function commit() {
    if (!preview) return;
    const n = await commitImport(preview, onExisting, (d, t) => setProgress(`${d} / ${t}`));
    setProgress('');
    setDone(n);
    await app.reload();
  }

  const errRows = preview?.results.filter((r) => r.errors.length) ?? [];
  const warnRows = preview?.results.filter((r) => !r.errors.length && r.warnings.length) ?? [];
  return <main className="page admin-import">
    <PageHeader title="インポート" back="/admin" />
    <section className="card">
      <p>CSV（UTF-8・1行目は列名）または JSON を読み込みます。取り込む前に全行を検証します。</p>
      {isIOS() && !isStandalone() && <p className="alert-msg">ホーム画面に追加したアプリから取り込んでください。Safariで取り込んだデータはホーム画面アプリには表示されません。</p>}
      <div className="btn-row">
        <button className="btn-primary" onClick={() => fileRef.current?.click()}>ファイルを選ぶ（複数可）</button>
        <button className="btn-secondary sm" onClick={() => download('cfp-questions-template.csv', '﻿' + csvTemplate(), 'text/csv')}>CSVテンプレート</button>
        <button className="btn-secondary sm" onClick={() => download('cfp-questions-sample.json', JSON.stringify({ questions: SAMPLE_QUESTIONS.slice(0, 3) }, null, 1))}>JSON見本</button>
      </div>
      <input ref={fileRef} type="file" multiple accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.length && load([...e.target.files])} />
      <p className="footnote">必須：question_id, subject, question_text, choice_a〜d, correct_answer（A〜D/1〜4）, explanation, law_reference_date。列の説明は docs/02_import_format.md。</p>
    </section>
    {progress && <p className="toast">{progress}</p>}
    {parseErrors.length > 0 && <ul className="msg-list warn">{parseErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
    {preview && <section className="card">
      <h3>{name}</h3>
      <ul className="kv-list">
        <li><span>取り込み可能</span><b>{preview.ok}行</b></li>
        <li><span>エラー（取り込まない）</span><b className={errRows.length ? 'bad' : ''}>{preview.errors}行</b></li>
        <li><span>警告あり（取り込む）</span><b>{preview.warnings}行</b></li>
        <li><span>既存IDと重複</span><b>{preview.existing}行</b></li>
        <li><span>新しく作られる論点ノード</span><b>{preview.newNodes.length}</b></li>
      </ul>
      {preview.existing > 0 && <div className="chips"><span className="muted">既存IDは</span>
        <button className={`chip sm ${onExisting === 'skip' ? 'on' : ''}`} onClick={() => setOnExisting('skip')}>スキップ</button>
        <button className={`chip sm ${onExisting === 'overwrite' ? 'on' : ''}`} onClick={() => setOnExisting('overwrite')}>上書き</button></div>}
      {errRows.length > 0 && <details open><summary>エラー行（{errRows.length}）</summary><ul className="msg-list err">{errRows.slice(0, 200).map((r) => <li key={r.row}><b>{r.row}行目</b> {r.errors.join(' / ')}</li>)}</ul></details>}
      {warnRows.length > 0 && <details><summary>警告行（{warnRows.length}）</summary><ul className="msg-list warn">{warnRows.slice(0, 200).map((r) => <li key={r.row}><b>{r.row}行目</b> {r.warnings.join(' / ')}</li>)}</ul></details>}
      {preview.newNodes.length > 0 && <details><summary>新しい論点ノード（{preview.newNodes.length}）</summary><ul className="msg-list">{preview.newNodes.slice(0, 200).map((n) => <li key={n.id}>{n.id.replace(/>/g, ' › ')}</li>)}</ul></details>}
      {done == null
        ? <button className="btn-primary btn-xl" disabled={!preview.ok} onClick={commit}>{preview.ok - (onExisting === 'skip' ? preview.existing : 0)}問を取り込む</button>
        : <p className="ok-msg">{done}問を取り込みました。<Link to="/admin">問題管理へ</Link></p>}
    </section>}
    {!preview && <Empty><Icon name="info" size={16} /> ファイルを選ぶと検証結果がここに表示されます</Empty>}
  </main>;
}
