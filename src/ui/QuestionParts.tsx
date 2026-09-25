import { useEffect, useState } from 'react';
import type { ChoiceKey, Question } from '../domain/types';
import { CHOICE_KEYS, SUBJECT_MAP, SOURCE_TYPES } from '../domain/subjects';
import { getCaseGroup } from '../data/repo';
import { lawWarning } from '../data/validate';
import { isExplained, splitPoints } from '../data/quality';
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

/**
 * 回答後の解説（Progressive Disclosure）。
 * 表: 一言解説 → POINT → TRAP → [なぜ◯ではない？][1〜4を詳しく見る][計算過程を見る]
 * 押したものだけ開く。何も押さずに次へ進める。
 */
export function Explanation({ q, order, selected, openDetail, onOpenDetail }: { q: Question; order: ChoiceKey[]; selected?: ChoiceKey | null; openDetail: boolean; onOpenDetail?: () => void }) {
  const no = (k: ChoiceKey) => order.indexOf(k) + 1;
  const wrong = !!selected && selected !== q.correct_answer;
  const steps = q.calculation_steps ?? [];
  const [why, setWhy] = useState(false);
  const [all, setAll] = useState(openDetail);
  const [calc, setCalc] = useState(openDetail && steps.length > 0);
  const points = splitPoints(q.key_point);
  const pending = !isExplained(q);
  const open = (set: (v: boolean) => void, cur: boolean) => () => { set(!cur); if (!cur) onOpenDetail?.(); };

  return <div className="explain">
    {q.explanation_short && <p className="short-ex">{q.explanation_short}</p>}
    {points.length > 0 && <div className="keypoint"><h4>POINT</h4>
      {points.length > 1 ? <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul> : <p>{points[0]}</p>}</div>}
    {q.trap && <div className="trap"><h4>TRAP ⚡</h4><p>{q.trap}</p></div>}
    {pending && <p className="pending">解説準備中（公式解答：{no(q.correct_answer)}）</p>}
    <LawNote q={q} correctNo={no(q.correct_answer)} />

    <div className="dig-row">
      {wrong && <button className={`dig ${why ? 'on' : ''}`} aria-expanded={why} onClick={open(setWhy, why)}>なぜ{no(selected!)}ではない？</button>}
      <button className={`dig ${all ? 'on' : ''}`} aria-expanded={all} onClick={open(setAll, all)}>1〜4を詳しく見る</button>
      {steps.length > 0 && <button className={`dig ${calc ? 'on' : ''}`} aria-expanded={calc} onClick={open(setCalc, calc)}>計算過程を見る</button>}
    </div>

    {why && wrong && <div className="why">
      <h4>なぜ{no(selected!)}ではない？</h4>
      <Markdown text={choiceExplanation(q, selected!) || 'この選択肢の解説はまだありません。'} />
      <div className="contrast">
        <h5>この違いを覚える</h5>
        <div className="ct ng"><b>×</b><span>{no(selected!)}．{choiceText(q, selected!)}</span></div>
        <div className="ct ok"><b>○</b><span>{no(q.correct_answer)}．{choiceText(q, q.correct_answer)}</span></div>
      </div>
      {!all && <button className="subtle-btn" onClick={open(setAll, false)}>他の選択肢も見る</button>}
    </div>}

    {calc && <ol className="steps">{steps.map((st, i) => <li key={i}><span className="step-no">STEP {i + 1}</span><Markdown text={st} /></li>)}</ol>}

    {all && <>
      <ul className="choice-cards">
        {order.map((k, i) => {
          const ok = k === q.correct_answer;
          return <li key={k} className={`${ok ? 'cc-ok' : 'cc-ng'} ${k === selected ? 'cc-mine' : ''}`}>
            <div className="cc-head"><span className="choice-no sm">{i + 1}</span><b>{ok ? '✓ CORRECT' : '×'}</b>{k === selected && <span className="mine">あなたの回答</span>}</div>
            <p className="cc-choice">{choiceText(q, k)}</p>
            {choiceExplanation(q, k) && <Markdown text={choiceExplanation(q, k)!} />}
          </li>;
        })}
      </ul>
      {!pending && q.explanation && <Collapse title="詳しい解説"><Markdown text={q.explanation} />{q.calc_method && <p className="calc-method"><b>計算方法：</b>{q.calc_method}</p>}</Collapse>}
    </>}

    {q.related_topics.length > 0 && <p className="related"><span className="muted">関連論点：</span>{q.related_topics.join('・')}</p>}
    <p className="source muted"><VerifyBadge q={q} />
      {q.law_revision_flag === 'verified' && <span className="badge ok">✓ 法令確認済み</span>}
      {q.law_revision_flag === 'needs_check' && <span className="badge warn">⚠ 法改正確認が必要</span>}
      {sourceLabel(q)}・法令基準日 {q.law_reference_date}</p>
  </div>;
}

/** 公式解答と独立検証が一致したものだけ VERIFIED。不一致・要確認は CHECK REQUIRED */
export function VerifyBadge({ q }: { q: Question }) {
  if (q.verification_status === 'verified' && q.verified_answer === q.correct_answer) return <span className="badge ok">✓ VERIFIED</span>;
  if (q.verification_status === 'mismatch' || q.verification_status === 'needs_review') return <span className="badge warn">⚠ CHECK REQUIRED</span>;
  return null;
}

/** 法改正の状態。旧制度は「出題当時の正解」と「現在の制度」を分けて示す */
function LawNote({ q, correctNo }: { q: Question; correctNo: number }) {
  if (q.law_revision_flag === 'outdated') return <div className="law-old">
    <span className="badge old">OLD 旧制度問題</span>
    <p><b>出題当時の正解：</b>{correctNo}</p>
    <p><b>現在の制度：</b>{q.current_rule_note || '現行制度では内容が異なります（未記入）'}</p>
  </div>;
  return null;
}
