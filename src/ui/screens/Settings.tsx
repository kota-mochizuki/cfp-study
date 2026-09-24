import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/store';
import { db } from '../../data/db';
import { exportBackup, restoreBackup } from '../../data/repo';
import { ymd } from '../../lib/time';
import { isIOS, isStandalone, storageInfo, type StorageInfo } from '../../lib/device';
import { Icon, PageHeader } from '../components';

export function download(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsScreen() {
  const app = useApp();
  const s = app.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [storage, setStorage] = useState<StorageInfo>();
  useEffect(() => { storageInfo().then(setStorage); }, [app.metas.length]);

  async function restore(f: File) {
    if (!confirm('現在のデータをすべて置き換えて復元します。よろしいですか？')) return;
    try { await restoreBackup(await f.text()); await app.reload(); setMsg('復元しました'); }
    catch (e) { setMsg(`復元できませんでした：${(e as Error).message}`); }
  }
  async function resetLearning() {
    if (!confirm('回答履歴・復習スケジュール・セッションを削除します（問題データは残ります）。よろしいですか？')) return;
    await db.transaction('rw', db.attempts, db.cards, db.sessions, async () => { await db.attempts.clear(); await db.cards.clear(); await db.sessions.clear(); });
    await app.updateSettings({ priors: {}, diagnosticDone: false });
    await app.reload();
    setMsg('学習データをリセットしました');
  }

  return <main className="page settings">
    <PageHeader title="設定" />
    {msg && <p className="toast" onClick={() => setMsg('')}>{msg}</p>}

    <section className="card form">
      <h3>試験</h3>
      <label>目標試験日<input type="date" value={s.examDate} onChange={(e) => app.updateSettings({ examDate: e.target.value })} /></label>
      <label>法令基準日
        <input type="date" value={s.lawBaseDate} onChange={(e) => app.updateSettings({ lawBaseDate: e.target.value })} />
        <small>2027年6月（第1回）は前年10月1日施行法令が基準となるのが通例。試験要項の公表後に確認してください。これより古い「要確認」の問題に警告を出します。</small>
      </label>
      <label>合格目安（模試）
        <select value={s.passLineRatio} onChange={(e) => app.updateSettings({ passLineRatio: Number(e.target.value) })}>
          {[0.5, 0.54, 0.56, 0.6, 0.64].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%（50問中{Math.round(v * 50)}問）</option>)}
        </select>
      </label>
    </section>

    <section className="card form">
      <h3>学習</h3>
      <label className="switch"><span>ホームを簡略表示（内訳を隠す）</span><input type="checkbox" checked={s.simpleHome} onChange={(e) => app.updateSettings({ simpleHome: e.target.checked })} /></label>
      <label className="switch"><span>選択肢の順番をシャッフル（位置の暗記を防ぐ）</span><input type="checkbox" checked={s.shuffleChoices} onChange={(e) => app.updateSettings({ shuffleChoices: e.target.checked })} /></label>
      <label className="switch"><span>旧制度の問題も出題する</span><input type="checkbox" checked={s.includeOutdated} onChange={(e) => app.updateSettings({ includeOutdated: e.target.checked })} /></label>
      <label>表示
        <select value={s.theme} onChange={(e) => app.updateSettings({ theme: e.target.value as typeof s.theme })}>
          <option value="auto">端末に合わせる</option><option value="light">ライト</option><option value="dark">ダーク</option>
        </select>
      </label>
      <p className="footnote">1問あたりの所要時間（学習済み）：約{s.secPerQuestion}秒 ／ 復習間隔：{s.intervals.join('→')}日</p>
    </section>

    <section className="card">
      <h3>問題データ</h3>
      <ul className="link-list">
        <li><Link to="/admin"><span>問題管理（追加・編集・削除・検索）</span><Icon name="chevron" size={16} /></Link></li>
        <li><Link to="/admin/import"><span>CSV / JSON インポート</span><Icon name="chevron" size={16} /></Link></li>
      </ul>
      <p className="footnote">登録済み {app.metas.length}問（出題対象 {app.activeMetas.length}問）・論点ノード {app.nodes.length}</p>
    </section>

    <section className="card">
      <h3>この端末の保存状況</h3>
      <ul className="kv-list">
        <li><span>起動方法</span><b>{isStandalone() ? 'ホーム画面アプリ（オフライン可）' : 'ブラウザ'}</b></li>
        <li><span>データの永続保存</span><b>{storage?.persisted == null ? '—' : storage.persisted ? '有効' : '未許可'}</b></li>
        <li><span>使用量</span><b>{storage?.usageMB != null ? `${storage.usageMB.toFixed(1)}MB` : '—'}</b></li>
      </ul>
      {isIOS() && !isStandalone() && <p className="alert-msg">iPhoneでは「共有 → ホーム画面に追加」して、そのアプリから使ってください。Safariで開いたページとホーム画面アプリはデータが別々で、Safari側は長く使わないと消えることがあります。</p>}
    </section>

    <section className="card">
      <h3>バックアップ</h3>
      <p className="footnote">データはこの端末のブラウザ内だけに保存されています。機種変更・PC移行・万一に備えて定期的に書き出してください。</p>
      <div className="btn-row">
        <button className="btn-secondary" onClick={async () => download(`cfp-study-backup-${ymd(Date.now())}.json`, await exportBackup())}>書き出す</button>
        <button className="btn-secondary" onClick={() => fileRef.current?.click()}>復元する</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      </div>
    </section>

    <section className="card">
      <ul className="link-list">
        <li><Link to="/dev"><span>開発者メニュー（開発時間・アイデア・週次レビュー）</span><Icon name="chevron" size={16} /></Link></li>
      </ul>
    </section>

    <section className="card danger">
      <button className="btn-danger" onClick={resetLearning}>学習データをリセット</button>
    </section>
  </main>;
}
