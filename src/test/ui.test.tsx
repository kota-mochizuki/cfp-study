// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../app/App';
import { db } from '../data/db';

beforeEach(async () => {
  await db.delete();
  await db.open();
  window.location.hash = '#/';
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe('UI スモーク', () => {
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
      await screen.findByRole('status', {}, { timeout: 5000 });
      expect(screen.getByText('この問題のポイント')).toBeTruthy();
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
