import { useEffect, useState } from 'react';
import type { ChoiceKey, Question } from '../domain/types';
import { CHOICE_KEYS, SUBJECT_MAP, SOURCE_TYPES } from '../domain/subjects';
import { getCaseGroup } from '../data/repo';
import { lawWarning } from '../data/validate';
import type { CaseGroup } from '../domain/types';
import { rng, shuffle } from '../lib/random';
import { Collapse, Markdown } from './components';

export const choiceText = (q: Question, k: ChoiceKey) => q[`choice_${k.toLowerCase()}` as 'choice_a'];
export const choiceExplanation = (q: Question, k: ChoiceKey) => q[`explanation_${k.toLowerCase()}` as 'explanation_a'];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 表示順（シャッフル設定時はセッション×問題で固定の順序） */
export function choiceOrder(q: Question, shuffleOn: boolean, seed: string): ChoiceKey[] {
  return shuffleOn ? shuffle(CHOICE_KEYS, rng(hash(seed + q.question_id))) : CHOICE_KEYS;
}

export function sourceLabel(q: Question): string {
  if (q.source_type === 'official_past_exam' && q.source_year)
    return `${q.source_year}年度第${q.source_exam ?? '?'}回 問${q.source_question_number ?? '?'}`;
  return SOURCE_TYPES[q.source_type];
}

export function QuestionBody({ q, topicName, lawBaseDate, index, total }: { q: Question; topicName: string; lawBaseDate: string; index?: number; total?: number }) {
  const [group, setGroup] = useState<CaseGroup>();
  useEffect(() => {
    setGroup(undefined);
    if (q.case_group_id) getCaseGroup(q.case_group_id).then(setGroup);
  }, [q.case_group_id]);
  const warn = lawWarning(q, lawBaseDate);
  return <div className="qbody">
    <div className="qmeta">
      {index != null && <span className="qno">{index}{total ? `/${total}` : ''}</span>}
      <span>{SUBJECT_MAP[q.subject].short}</span><span className="sep">/</span><span className="qtopic">{topicName}</span>
    </div>
    {warn && <p className="law-warn" role="note">⚠ {warn}</p>}
    {group && <Collapse title={`事例：${group.title}`} defaultOpen className="case-box">
      <Markdown text={group.case_text} />
      {group.images && <SourceImages images={group.images} />}
    </Collapse>}
    <Markdown text={q.question_text} className="qtext" />
    {q.images && <Collapse title="原本の資料（画像）" defaultOpen className="case-box"><SourceImages images={q.images} /></Collapse>}
  </div>;
}

/** 表・グラフなど文字にできない資料は原本ページの画像で示す（ピンチで拡大可） */
function SourceImages({ images }: { images: string[] }) {
  return <div className="src-images">{images.map((src, i) => <img key={i} src={src} alt={`原本の資料 ${i + 1}`} loading="lazy" />)}</div>;
}

type ChoiceState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dim';

export function Choices({ q, order, selected, revealed, onSelect }: { q: Question; order: ChoiceKey[]; selected: ChoiceKey | null; revealed: boolean; onSelect?: (k: ChoiceKey) => void }) {
  return <ol className="choices" role="radiogroup" aria-label="選択肢">
    {order.map((k, i) => {
      let st: ChoiceState = selected === k ? 'selected' : 'idle';
      if (revealed) st = k === q.correct_answer ? 'correct' : selected === k ? 'wrong' : 'dim';
      return <li key={k}>
        <button type="button" role="radio" aria-checked={selected === k} className={`choice ch-${st}`} disabled={revealed} onClick={() => onSelect?.(k)}>
          <span className="choice-no">{i + 1}</span>
          <span className="choice-text">{choiceText(q, k)}</span>
          {revealed && k === q.correct_answer && <span className="choice-mark">○</span>}
          {revealed && st === 'wrong' && <span className="choice-mark">×</span>}
        </button>
      </li>;
    })}
  </ol>;
}

/** 回答後の段階的解説: ポイント → 詳細解説（折りたたみ）→ 各選択肢 → 関連論点 */
export function Explanation({ q, order, openDetail, onOpenDetail }: { q: Question; order: ChoiceKey[]; openDetail: boolean; onOpenDetail?: () => void }) {
  const correctNo = order.indexOf(q.correct_answer) + 1;
  const hasChoiceEx = order.some((k) => choiceExplanation(q, k));
  return <div className="explain">
    {q.key_point && <div className="keypoint"><h4>この問題のポイント</h4><Markdown text={q.key_point} /></div>}
    <Collapse title={<>解説<span className="muted">（正解 {correctNo}）</span></>} defaultOpen={openDetail} onToggle={(o) => o && onOpenDetail?.()}>
      <Markdown text={q.explanation} />
      {q.calc_method && <p className="calc-method"><b>計算方法：</b>{q.calc_method}</p>}
    </Collapse>
    {hasChoiceEx && <Collapse title="各選択肢の解説" defaultOpen={openDetail} onToggle={(o) => o && onOpenDetail?.()}>
      <ul className="choice-ex">
        {order.map((k, i) => <li key={k} className={k === q.correct_answer ? 'is-correct' : ''}>
          <span className="choice-no sm">{i + 1}</span>
          <div><Markdown text={choiceExplanation(q, k) || (k === q.correct_answer ? '正しい。' : '—')} /></div>
        </li>)}
      </ul>
    </Collapse>}
    {q.related_topics.length > 0 && <p className="related"><span className="muted">関連論点：</span>{q.related_topics.join('・')}</p>}
    <p className="source muted">{sourceLabel(q)}・法令基準日 {q.law_reference_date}</p>
  </div>;
}
