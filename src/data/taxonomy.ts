import type { Question, QuestionMeta, SubjectId, TaxNode } from '../domain/types';
import { SUBJECTS } from '../domain/subjects';
import guide from './seed/taxonomy.json';

/** 課目ノード＋FP学習ガイド（2026/4/1改定）から抽出した大・中・小分類 */
export function seedNodes(): TaxNode[] {
  return [
    ...SUBJECTS.map((s) => ({ id: s.id, parentId: null, level: 'subject' as const, name: s.name, order: s.no })),
    ...(guide as TaxNode[]),
  ];
}

export const normName = (s: string) => s.normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();

/**
 * 論点マスタの名前解決。インポート時に「課目 → 大 → 中 → 小 → 論点」を名前で辿り、
 * 見つからない階層は新規ノードとして作る（学習ガイド外の論点も受け入れる）。
 */
export class TaxonomyIndex {
  private byId = new Map<string, TaxNode>();
  private children = new Map<string, TaxNode[]>();
  readonly created: TaxNode[] = [];

  constructor(nodes: TaxNode[]) {
    for (const n of nodes) this.add(n);
  }

  private add(n: TaxNode) {
    this.byId.set(n.id, n);
    if (n.parentId) {
      const arr = this.children.get(n.parentId) ?? [];
      arr.push(n);
      this.children.set(n.parentId, arr);
    }
  }

  get(id: string) { return this.byId.get(id); }

  /** 子ノードを名前で検索。無ければ作成 */
  child(parentId: string, name: string, level: TaxNode['level']): TaxNode {
    const key = normName(name);
    const kids = this.children.get(parentId) ?? [];
    const hit = kids.find((k) => normName(k.name) === key);
    if (hit) return hit;
    // 階層を1つ飛ばして書かれた場合（例: 中分類名を大分類欄に書いた）も拾う
    for (const k of kids) {
      const deep = (this.children.get(k.id) ?? []).find((g) => normName(g.name) === key);
      if (deep) return deep;
    }
    const node: TaxNode = { id: `${parentId}>${name.trim()}`, parentId, level, name: name.trim(), order: 1000 + kids.length };
    this.add(node);
    this.created.push(node);
    return node;
  }

  resolve(subject: SubjectId, large?: string, middle?: string, small?: string, topic?: string): string {
    let cur = subject as string;
    const steps: [string | undefined, TaxNode['level']][] = [[large, 'large'], [middle, 'middle'], [small, 'small']];
    for (const [name, level] of steps) if (name?.trim()) cur = this.child(cur, name, level).id;
    if (topic?.trim()) {
      const curNode = this.byId.get(cur);
      // 論点名が直上の分類名と同じなら新ノードを作らない
      if (!curNode || normName(curNode.name) !== normName(topic)) cur = this.child(cur, topic, 'topic').id;
    }
    return cur;
  }
}

export function toMeta(q: Question): QuestionMeta {
  return {
    id: q.question_id, subject: q.subject, topicId: q.topic_id, difficulty: q.difficulty, importance: q.importance,
    frequency: q.frequency, type: q.question_type, source: q.source_type, year: q.source_year, lawFlag: q.law_revision_flag,
    lawDate: q.law_reference_date, status: q.status, caseGroupId: q.case_group_id, textLength: q.question_text.length,
  };
}
