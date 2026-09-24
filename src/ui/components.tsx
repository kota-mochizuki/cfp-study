import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { renderMarkdown } from '../lib/markdown';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const paths: Record<string, ReactNode> = {
  home: <path {...P} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  practice: <><rect {...P} x="4" y="3" width="16" height="18" rx="2" /><path {...P} d="M8 8h8M8 12h8M8 16h5" /></>,
  chart: <path {...P} d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  gear: <><circle {...P} cx="12" cy="12" r="3" /><path {...P} d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  search: <><circle {...P} cx="11" cy="11" r="7" /><path {...P} d="m20 20-3.5-3.5" /></>,
  star: <path {...P} d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
  starFill: <path fill="currentColor" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
  flag: <path {...P} d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  flagFill: <><path {...P} d="M5 21V4" /><path fill="currentColor" d="M5 4h11l-2 4 2 4H5z" /></>,
  close: <path {...P} d="M6 6l12 12M18 6 6 18" />,
  back: <path {...P} d="M15 18l-6-6 6-6" />,
  chevron: <path {...P} d="m9 6 6 6-6 6" />,
  info: <><circle {...P} cx="12" cy="12" r="9" /><path {...P} d="M12 11v5M12 8h.01" /></>,
  note: <><path {...P} d="M4 20h4L19 9l-4-4L4 16z" /><path {...P} d="m13 7 4 4" /></>,
  grid: <path {...P} d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths | string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

export function Bar({ value, tone = 'primary', thin }: { value: number; tone?: 'primary' | 'ok' | 'ng' | 'muted'; thin?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  return <div className={`bar ${thin ? 'bar-thin' : ''}`} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
    <div className={`bar-fill tone-${tone}`} style={{ width: `${v * 100}%` }} />
  </div>;
}

export function Collapse({ title, defaultOpen = false, children, onToggle, className }: { title: ReactNode; defaultOpen?: boolean; children: ReactNode; onToggle?: (open: boolean) => void; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className={`collapse ${open ? 'open' : ''} ${className ?? ''}`}>
    <button type="button" className="collapse-head" aria-expanded={open} onClick={() => { setOpen(!open); onToggle?.(!open); }}>
      <span>{title}</span><Icon name="chevron" size={18} />
    </button>
    {open && <div className="collapse-body">{children}</div>}
  </section>;
}

export function PageHeader({ title, back, right }: { title: string; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  return <header className="page-header">
    {back ? <button className="icon-btn" aria-label="戻る" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}><Icon name="back" /></button> : <span className="icon-spacer" />}
    <h1>{title}</h1>
    {right ?? <span className="icon-spacer" />}
  </header>;
}

export const pct = (x: number | null | undefined, digits = 0) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
