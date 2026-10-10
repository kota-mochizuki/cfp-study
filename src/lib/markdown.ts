/**
 * 問題文・解説・講義用の最小 Markdown（表・太字・箇条書き・改行・見出し ###・``` で囲んだ数式/図）。
 * 先に HTML エスケープしてからタグを組み立てるので、取り込んだデータに HTML が含まれていても安全。
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      flush();
      const head = cells(line);
      i += 1;
      const rows: string[][] = [];
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^```/.test(line)) {
      flush();
      const body: string[] = [];
      while (i + 1 < lines.length && !/^```/.test(lines[i + 1])) body.push(lines[++i]);
      i += 1;
      out.push(`<pre class="md-pre">${esc(body.join('\n'))}</pre>`);
    } else if (/^#{3,4}\s+/.test(line)) {
      flush();
      const lv = line.startsWith('####') ? 5 : 4;
      out.push(`<h${lv}>${inline(line.replace(/^#+\s+/, ''))}</h${lv}>`);
    } else if (/^\s*[-・]\s+/.test(line)) {
      flush();
      const items = [line];
      while (i + 1 < lines.length && /^\s*[-・]\s+/.test(lines[i + 1])) items.push(lines[++i]);
      out.push(`<ul>${items.map((l) => `<li>${inline(l.replace(/^\s*[-・]\s+/, ''))}</li>`).join('')}</ul>`);
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return out.join('');
}
