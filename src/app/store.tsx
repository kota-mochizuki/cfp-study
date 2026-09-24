import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Attempt, Card, QuestionMeta, Settings, TaxNode, UxEvent } from '../domain/types';
import { computeStats, type NodeStat } from '../engine/mastery';
import { uxPrefs, type UxPrefs } from '../engine/insights';
import { bootstrap } from '../data/bootstrap';
import { allAttempts, allEvents, loadCore, saveSettings } from '../data/repo';

interface AppState {
  ready: boolean;
  metas: QuestionMeta[];
  /** 出題対象（active かつ 設定により旧制度除外） */
  activeMetas: QuestionMeta[];
  metaMap: Map<string, QuestionMeta>;
  cards: Map<string, Card>;
  nodes: TaxNode[];
  nodeMap: Map<string, TaxNode>;
  favorites: Set<string>;
  settings: Settings;
  stats: Map<string, NodeStat>;
  /** 回答履歴（起動後に非同期で読み込む。分析・学習状況用） */
  attempts: Attempt[] | null;
  events: UxEvent[];
  prefs: UxPrefs;
  /** 本人の回答時間の中央値（遅い正解の判定・SRS用） */
  avgTimeMs: number;
  reload: () => Promise<void>;
  putCard: (c: Card) => void;
  addAttempt: (a: Attempt) => void;
  patchAttempt: (id: number, patch: Partial<Attempt>) => void;
  setFavorite: (id: string, on: boolean) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshEvents: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<Awaited<ReturnType<typeof loadCore>> | null>(null);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [events, setEvents] = useState<UxEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    const c = await loadCore();
    setCore(c);
    setNow(Date.now());
    allAttempts().then(setAttempts);
    allEvents().then(setEvents);
  }, []);

  useEffect(() => {
    bootstrap().then(reload);
    // ブラウザの容量不足時に学習データが消されないよう永続化を要求（ホーム画面アプリでは通常許可される）
    navigator.storage?.persist?.().catch(() => {});
  }, [reload]);

  useEffect(() => {
    const theme = core?.settings.theme ?? 'auto';
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [core?.settings.theme]);

  const value = useMemo<AppState | null>(() => {
    if (!core) return null;
    const { metas, cards, nodes, favorites, settings } = core;
    const activeMetas = metas.filter((m) => m.status === 'active' && (settings.includeOutdated || m.lawFlag !== 'outdated'));
    const stats = computeStats({ nodes, metas: activeMetas, cards, now, priors: settings.priors });
    return {
      ready: true, metas, activeMetas, metaMap: new Map(metas.map((m) => [m.id, m])), cards, nodes,
      nodeMap: new Map(nodes.map((n) => [n.id, n])), favorites, settings, stats, attempts, events,
      prefs: uxPrefs((attempts ?? []).slice(-200), events, now),
      avgTimeMs: medianTime(attempts),
      reload,
      putCard: (c) => setCore((p) => p && { ...p, cards: new Map(p.cards).set(c.questionId, c) }),
      addAttempt: (a) => { setAttempts((p) => (p ? [...p, a] : p)); setNow(Date.now()); },
      patchAttempt: (id, patch) => setAttempts((p) => p && p.map((a) => (a.id === id ? { ...a, ...patch } : a))),
      setFavorite: (id, on) => setCore((p) => {
        if (!p) return p;
        const f = new Set(p.favorites);
        if (on) f.add(id); else f.delete(id);
        return { ...p, favorites: f };
      }),
      updateSettings: async (patch) => {
        const next = { ...settings, ...patch };
        await saveSettings(next);
        setCore((p) => p && { ...p, settings: next });
      },
      refreshEvents: async () => setEvents(await allEvents()),
    };
  }, [core, attempts, events, now, reload]);

  if (!value) return <div className="boot"><div className="boot-mark">CFP</div></div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider がありません');
  return v;
}

function medianTime(attempts: Attempt[] | null): number {
  const xs = (attempts ?? []).slice(-100).map((a) => a.timeMs).sort((a, b) => a - b);
  return xs.length >= 10 ? xs[Math.floor(xs.length / 2)] : 40_000;
}
