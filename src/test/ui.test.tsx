// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../app/App';
import { db } from '../data/db';

beforeEach(async () => {
  await db.delete();
  await db.open();
  // 画面の基本動作はサンプル問題で確認する（既定の「講義の問題だけ」は個別のテストで確かめる）
  await db.kv.put({ key: 'settings', value: { lectureOnly: false } });
  window.location.hash = '#/';
  window.scrollTo = () => {};
  // テストは本物のネットワークに接続しない（講義の取得は個別のテストで差し替える）
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe('UI スモーク', () => {
  it('解説: 誤答 → REVENGE ADDED → なぜ◯ではない？ → 1〜4すべて → 計算過程。正答で REVENGE COMPLETE', async () => {
    // 最終利回りの問題だけを出す（正解は4）
    const { bootstrap } = await import('../data/bootstrap');
    await bootstrap();
    window.location.hash = '#/search';
    render(<App />);
    fireEvent.change(await screen.findByRole('searchbox', {}, { timeout: 5000 }), { target: { value: '最終利回り 98円' } });
    fireEvent.click(await screen.findByText(/表面利率1.0%/, {}, { timeout: 5000 }));
    const pick = async (n: number) => {
      const radios = within(await screen.findByRole('radiogroup', { name: '選択肢' }, { timeout: 5000 })).getAllByRole('radio');
      fireEvent.click(radios[n - 1]);
      fireEvent.click(screen.getByRole('button', { name: '回答する' }));
      return screen.findByRole('status', {}, { timeout: 5000 });
    };
    const v1 = await pick(3);
    expect(v1.textContent).toContain('REVENGE ADDED');
    expect(v1.textContent).toContain('あなたの回答：3');
    expect(v1.textContent).toContain('正解：4');
    expect(screen.getByText('POINT')).toBeTruthy();
    expect(screen.getByText(/TRAP/)).toBeTruthy();
    // 詳しい解説はまだ出ていない（テンポ優先）
    expect(screen.queryByText('✓ CORRECT')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'なぜ3ではない？' }));
    expect(screen.getByText('この違いを覚える')).toBeTruthy();
    expect(screen.getByText(/分母を額面100円にした誤り/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1〜4を詳しく見る' }));
    expect(screen.getAllByText('×').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('✓ CORRECT')).toBeTruthy();
    expect(screen.getByText('あなたの回答')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '計算過程を見る' }));
    expect(screen.getByText('STEP 5')).toBeTruthy();
    expect(screen.getByText('✓ VERIFIED')).toBeTruthy();
    // 誤答の選択肢は記録される
    const card = await db.cards.get('ORIG-FIN-0001');
    expect(card?.wrongChoices?.C).toBe(1);
    cleanup();

    // もう一度同じ問題 → 正解で REVENGE COMPLETE、前回の誤答を表示
    window.location.hash = '#/search';
    render(<App />);
    fireEvent.change(await screen.findByRole('searchbox', {}, { timeout: 5000 }), { target: { value: '最終利回り 98円' } });
    fireEvent.click(await screen.findByText(/表面利率1.0%/, {}, { timeout: 5000 }));
    await screen.findByRole('button', { name: '回答する' }, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300)); // 回答履歴の非同期読み込みを待つ
    const v2 = await pick(4);
    expect(v2.textContent).toContain('REVENGE COMPLETE');
    expect(v2.textContent).toContain('前回：3');
  }, 30_000);

  it('ホーム → 学習を始める → 選択 → 回答 → 解説 → 次へ → 結果', async () => {
    render(<App />);
    const start = await screen.findByRole('button', { name: '学習を始める' }, { timeout: 5000 });
    expect(screen.getByText('今日の最適学習')).toBeTruthy();
    expect(screen.getByText(/試験まであと/)).toBeTruthy();

    // 5分を選ぶ → 5問
    fireEvent.click(screen.getByRole('radio', { name: '5分' }));
    fireEvent.click(start);

    // 誤答すると同論点のフォロー問題が差し込まれるため、5問より増えることがある
    for (let i = 0; i < 12; i++) {
      const answer = await screen.findByRole('button', { name: '回答する' }, { timeout: 5000 });
      expect((answer as HTMLButtonElement).disabled).toBe(true);
      const choices = within(screen.getByRole('radiogroup', { name: '選択肢' })).getAllByRole('radio');
      expect(choices.length).toBe(4);
      fireEvent.click(choices[0]);
      fireEvent.click(answer);
      // 連続正解の表示が加わると status が2つになるため、複数形で待つ
      await screen.findAllByRole('status', {}, { timeout: 5000 });
      expect(screen.getByText('POINT')).toBeTruthy();
      const done = screen.queryByRole('button', { name: '結果を見る' });
      fireEvent.click(done ?? screen.getByRole('button', { name: '次へ' }));
      if (done) break;
    }
    await screen.findByText(/問 正解/, {}, { timeout: 5000 });
    expect(await db.attempts.count()).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it('演習・分析・設定・問題管理の各画面が描画できる', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '学習を始める' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('link', { name: /演習/ }));
    await screen.findByText('Surprise 5');
    fireEvent.click(screen.getByRole('link', { name: /分析/ }));
    await screen.findByText('本番準備度');
    await screen.findByText('My CFP Profile');
    fireEvent.click(screen.getByRole('link', { name: /設定/ }));
    await screen.findByText('バックアップ');
    fireEvent.click(screen.getByRole('link', { name: /問題管理/ }));
    await screen.findByText('ORIG-FIN-0001', {}, { timeout: 5000 });
  }, 30_000);

  it('本番模試: 回答中は正誤を出さず、提出後に採点', async () => {
    window.location.hash = '#/mock';
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '相続' }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole('button', { name: '模試を開始' }));
    await screen.findByRole('radiogroup', { name: '選択肢' }, { timeout: 5000 });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '選択肢' })).getAllByRole('radio')[2]);
    expect(screen.queryByRole('status')).toBeNull();
    window.confirm = () => true;
    fireEvent.click(screen.getByRole('button', { name: '問題一覧' }));
    fireEvent.click(screen.getByRole('button', { name: '提出して採点' }));
    await screen.findByText('模試の結果', {}, { timeout: 5000 });
    await waitFor(() => expect(screen.getByText('分野別正答率')).toBeTruthy());
  }, 30_000);
});

describe('講義', () => {
  it('本文を表示し、確認問題は回答するまで解説を隠す。回答は履歴に残る', async () => {
    const q = (n: number) => ({
      question_id: `LEC-L001-Q${n}`, subject: 'finance', category_large: 'ライフプランと金融資産運用設計', category_middle: 'ライフプランと目標リターンの算出',
      topic: 'ライフプランと目標リターンの算出', question_text: `確認問題その${n}`, choice_a: `選択肢あ${n}`, choice_b: `選択肢い${n}`, choice_c: `選択肢う${n}`, choice_d: `選択肢え${n}`,
      correct_answer: 'B', verified_answer: 'B', verification_status: 'verified', explanation: '詳しい解説', explanation_short: '一言解説です',
      explanation_a: '× 誤り。正しくは い である。', explanation_b: '○ 正しい記述である。', explanation_c: '× 誤り。正しくは い である。', explanation_d: '× 誤り。正しくは い である。',
      key_point: 'ポイント', law_reference_date: '2027-01-01', law_revision_flag: 'verified', source_type: 'original', tags: '講義;L001', related_sections: [1],
    });
    const lecture = {
      id: 'L001', date: '2026-10-11', slot: 'am', subject: 'finance', title: '目標リターンの算出', minutes: 35, large: 'ライフプランと金融資産運用設計',
      middle: ['ライフプランと目標リターンの算出'], goals: ['必要な利回りを求められる'], plain: '目標のお金に届くには、貯金が1年で何%ふえればいいかの話です。', map: '```\n体系図\n```', sections: [{ title: '6つの係数', body: '### 終価係数\n本文です' }],
      traps: '期首払いに注意', questions: [1, 2, 3, 4, 5].map(q), sources: [{ name: '日本FP協会', url: 'https://www.jafp.or.jp/' }], lawBaseDate: '2027-01-01', verifiedOn: '2026-10-10', unconfirmed: [],
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).endsWith('index.json') ? [lecture] : lecture))) as typeof fetch;
    try {
      const { bootstrap } = await import('../data/bootstrap');
      await bootstrap();
      window.location.hash = '#/lecture/L001';
      render(<App />);
      expect(await screen.findByText('目標リターンの算出', {}, { timeout: 5000 })).toBeTruthy();
      // 本文は既定で閉じている（見出しだけ見える）
      expect(screen.getByRole('button', { name: /3-1　6つの係数/ }).getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('終価係数')).toBeNull();
      expect(screen.getByText('つまりどういうこと？')).toBeTruthy();
      expect(screen.getByText(/貯金が1年で何%/)).toBeTruthy();
      expect(screen.queryByText('一言解説です')).toBeNull();
      const first = screen.getAllByRole('radiogroup', { name: '選択肢' })[0];
      fireEvent.click(within(first).getAllByRole('radio')[2]);
      fireEvent.click(screen.getAllByRole('button', { name: '回答する' })[0]);
      expect((await screen.findByRole('status', {}, { timeout: 5000 })).textContent).toContain('× 不正解（正解：2）');
      expect(screen.getByText('一言解説です')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: '回答する' })).toHaveLength(4);
      // 間違えた問題から、関係する本文の節を開ける
      expect(screen.getByText('間違えた所は、本文のここを読むと分かります')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '3-1　6つの係数 を読む' }));
      expect(screen.getByText('終価係数').tagName).toBe('H4');
      await waitFor(async () => expect(((await db.kv.get('lectureStates'))!.value as Record<string, { open?: number[] }>).L001.open).toEqual([1]));
      await waitFor(async () => expect((await db.attempts.toArray()).map((a) => [a.questionId, a.selected, a.correct])).toEqual([['LEC-L001-Q1', 'C', false]]));
      const { buildLectureReport } = await import('../data/lectures');
      const report = await buildLectureReport(await db.attempts.toArray());
      expect(report).toContain('金融 0/1');
      expect(report).toContain('- LEC-L001-Q1｜ライフプランと目標リターンの算出｜選んだ答え 3・正解 2｜誤答1回・直近は不正解');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('講義の取り組みやすさ', () => {
  const mk = (id: string, subject: string, title: string, slot = 'am') => ({ id, date: '2026-10-1' + id.slice(-1), slot, subject, title, minutes: 35 });
  const lectures = [mk('L001', 'finance', '金融の講義その1'), mk('L002', 'realestate', '不動産の講義その2', 'pm'), mk('L003', 'life', 'ライフの講義その3')];
  async function withIndex(fn: () => Promise<void>) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(lectures))) as typeof fetch;
    try { await fn(); } finally { globalThis.fetch = realFetch; }
  }

  it('ホーム: 未完了の最新回へ直行するボタンを出し、読みかけなら「続きから読む」になる', async () => {
    await withIndex(async () => {
      const { bootstrap } = await import('../data/bootstrap');
      await bootstrap();
      render(<App />);
      const link = await screen.findByRole('link', { name: /次の講義を読む/ }, { timeout: 5000 });
      expect(link.getAttribute('href')).toBe('#/lecture/L003');
      expect(link.textContent).toContain('ライフの講義その3');
      cleanup();
      await db.kv.put({ key: 'lectureStates', value: { L003: { openedAt: 1, scrollY: 900, answers: {} } } });
      render(<App />);
      expect((await screen.findByRole('link', { name: /続きから読む/ }, { timeout: 5000 })).getAttribute('href')).toBe('#/lecture/L003');
    });
  });

  it('講義一覧: 昼・夕の回は3問で完了になり、朝の回は3問ではまだ完了にならない', async () => {
    await withIndex(async () => {
      const { bootstrap } = await import('../data/bootstrap');
      await bootstrap();
      await db.kv.put({ key: 'lectureStates', value: {
        L001: { openedAt: 1, answers: { a: 'A', b: 'A', c: 'A' } },
        L002: { openedAt: 1, answers: { a: 'A', b: 'A', c: 'A' } },
      } });
      window.location.hash = '#/lectures';
      render(<App />);
      await screen.findByText('金融の講義その1', {}, { timeout: 5000 });
      expect(screen.getByText('問題 3/5')).toBeTruthy();
      expect(screen.getByText('完了')).toBeTruthy();
    });
  });

  it('講義一覧: 課目で絞り込める。未完了だけにもできる', async () => {
    await withIndex(async () => {
      const { bootstrap } = await import('../data/bootstrap');
      await bootstrap();
      await db.kv.put({ key: 'lectureStates', value: { L001: { openedAt: 1, answers: { a: 'A', b: 'A', c: 'A', d: 'A', e: 'A' } } } });
      window.location.hash = '#/lectures';
      render(<App />);
      expect(await screen.findByText('金融の講義その1', {}, { timeout: 5000 })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'ライフ' }));
      expect(screen.queryByText('金融の講義その1')).toBeNull();
      expect(screen.getByText('ライフの講義その3')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'ライフ' }));
      fireEvent.click(screen.getByRole('button', { name: '未完了' }));
      expect(screen.queryByText('金融の講義その1')).toBeNull();
      expect(screen.getByText('不動産の講義その2')).toBeTruthy();
    });
  });

  it('読んでいる位置は、回答の記録を消さずに保存される', async () => {
    const { saveLectureState, saveLectureScroll, lectureStates } = await import('../data/lectures');
    await saveLectureState('L001', { openedAt: 1, answers: { 'LEC-L001-Q1': 'B' } });
    await saveLectureScroll('L001', 1234.6);
    expect((await lectureStates()).L001).toMatchObject({ scrollY: 1235, answers: { 'LEC-L001-Q1': 'B' } });
    await saveLectureScroll('L999', 50);
    expect((await lectureStates()).L999).toBeUndefined();
  });
});
