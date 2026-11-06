import { useEffect, useState } from 'react';
import type { Issue, IssueStatus } from './data';
import type { IssueFields } from './useIssues';
import { Icon } from './Icon';

interface Props {
  issue: Issue | null;
  index: number;
  total: number;
  onStep: (delta: number) => void;
  onTransition: (id: string, status: IssueStatus, fields?: IssueFields) => void;
  collapsed: boolean;
  onToggle: () => void;
  /** сколько замечаний ещё не закрыто */
  openCount: number;
}

export const statusLabel: Record<IssueStatus, string> = {
  open: 'Открыто',
  asked: 'Ожидает ответа владельца',
  answered: 'Ответ получен',
  fixed: 'Исправлено',
  closed: 'Закрыто',
};

const steps: { id: IssueStatus; label: string }[] = [
  { id: 'open', label: 'Открыто' },
  { id: 'asked', label: 'Вопрос' },
  { id: 'answered', label: 'Ответ' },
  { id: 'fixed', label: 'Исправлено' },
  { id: 'closed', label: 'Закрыто' },
];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function IssuePanel({ issue, index, total, onStep, onTransition, collapsed, onToggle, openCount }: Props) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [issue?.id, issue?.status]);

  const collapse = (
    <button type="button" className="icon-btn" aria-label="Свернуть панель замечаний" title="Свернуть" aria-expanded onClick={onToggle}>
      <Icon name="chevronRight" />
    </button>
  );

  if (collapsed) {
    return (
      <aside className="panel rail">
        <button type="button" className="icon-btn" aria-label="Развернуть панель замечаний" title="Развернуть панель замечаний" aria-expanded={false} onClick={onToggle}>
          <Icon name="chevronLeft" />
        </button>
        {openCount > 0 && <span className="rail-badge" title="Открытых замечаний">{openCount}</span>}
        <span className="rail-label">Замечания</span>
      </aside>
    );
  }

  if (!issue) {
    return (
      <aside className="panel">
        <div className="panel-head">
          <strong>Замечание</strong>
          <div className="grow" />
          {collapse}
        </div>
        <div className="empty-panel">
          <b>Замечаний нет</b>
          <span>Они появятся, когда в модели будут шаги без пункта регламента или пункты без шага.</span>
        </div>
      </aside>
    );
  }

  const go = (status: IssueStatus, fields?: IssueFields) => onTransition(issue.id, status, fields);
  const current = steps.findIndex((s) => s.id === issue.status);
  const done = issue.status === 'fixed' || issue.status === 'closed';
  const trimmed = note.trim();

  return (
    <aside className="panel">
      <div className="panel-head">
        <strong>Замечание</strong>
        <span className="muted small">{index + 1} из {total}</span>
        <div className="grow" />
        <button type="button" className="icon-btn" aria-label="Предыдущее замечание" onClick={() => onStep(-1)}>
          <Icon name="chevronUp" />
        </button>
        <button type="button" className="icon-btn" aria-label="Следующее замечание" onClick={() => onStep(1)}>
          <Icon name="chevronDown" />
        </button>
        {collapse}
      </div>

      <div className="panel-body" key={issue.id}>
        <div className="stack-10">
          <span className={`chip ${done ? 'chip-green' : 'chip-amber'}`}>
            <span className={done ? 'dot-green' : 'dot-amber'} />
            {statusLabel[issue.status]}
          </span>
          <h2 className="issue-title">{issue.title}</h2>
          <ol className="stepper" aria-label="Этапы замечания">
            {steps.map((s, i) => (
              <li key={s.id} className={i < current ? 'past' : i === current ? 'now' : ''} aria-current={i === current ? 'step' : undefined}>
                <i />
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <section className="stack-8">
          <div className="label">Затрагивает</div>
          {issue.model && (
            <div className="ref-card">
              <span className="ref-icon"><Icon name="model" size={17} /></span>
              <span className="ref-text">
                <small>Модель · {issue.model.label}</small>
                <b>{issue.model.step}</b>
              </span>
            </div>
          )}
          {issue.doc && (
            <div className="ref-card">
              <span className="ref-icon"><Icon name="file" size={17} /></span>
              <span className="ref-text">
                <small>Документ · Регламент согласования</small>
                <b>{issue.doc.label}</b>
              </span>
            </div>
          )}
          <p className="note">{issue.summary}</p>
        </section>

        <section className="stack-8">
          <div className="label">Основание</div>
          {issue.basis ? (
            <div className="basis">
              <div className="basis-head">
                <span className={`ext ${issue.basis.sourceId === 'som' ? 'ext-pdf' : 'ext-docx'}`}>
                  {issue.basis.sourceId === 'som' ? 'PDF' : 'DOC'}
                </span>
                <b>{issue.basis.source}</b>
              </div>
              <span className="time-chip">
                <Icon name="play" size={11} />
                {issue.basis.fragment}
              </span>
              <p className="note">{issue.basis.quote}</p>
            </div>
          ) : (
            <div className="basis">
              <div className="basis-head"><b>Автопроверка покрытия</b></div>
              <p className="note">Замечание исчезнет, когда вы свяжете {issue.model ? 'шаг с пунктом регламента' : 'пункт с шагом модели'} в свойствах объекта (правая кнопка → «Свойства…» → «Связи»).</p>
            </div>
          )}
        </section>

        <section className="stack-8">
          <div className="label">Вопрос</div>
          <div className="question">{issue.question}</div>
        </section>

        {issue.answer && (
          <section className="stack-8">
            <div className="label">Ответ владельца</div>
            <div className="record">{issue.answer}</div>
          </section>
        )}
        {issue.resolution && (
          <section className="stack-8">
            <div className="label">Что изменили</div>
            <div className="record ok">{issue.resolution}</div>
          </section>
        )}

        {issue.history && issue.history.length > 0 && (
          <section className="stack-8">
            <div className="label">История</div>
            <ol className="history">
              {[...issue.history].reverse().map((h, i) => (
                <li key={i}>
                  <b>{statusLabel[h.status]}</b>
                  <time dateTime={h.at}>{fmt(h.at)}</time>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {issue.status !== 'open' && <div className="panel-foot">
        {issue.status === 'asked' && (
          <label className="foot-field">
            <span>Ответ владельца</span>
            <textarea className="pinput" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что ответил владелец процесса" />
          </label>
        )}
        {issue.status === 'answered' && (
          <label className="foot-field">
            <span>Что изменили в модели или регламенте</span>
            <textarea className="pinput" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например, добавили получателя в § 4.2" />
          </label>
        )}

        {issue.status === 'asked' && (
          <>
            <button type="button" className="cta" disabled={!trimmed} onClick={() => go('answered', { answer: trimmed })}>
              <Icon name="check" size={16} stroke={2.1} />
              Ответ получен
            </button>
            <button type="button" className="cta-ghost" onClick={() => go('open')}>Отозвать вопрос</button>
          </>
        )}
        {issue.status === 'answered' && (
          <>
            <button type="button" className="cta" disabled={!trimmed} onClick={() => go('fixed', { resolution: trimmed })}>
              <Icon name="check" size={16} stroke={2.1} />
              Исправлено
            </button>
            <button type="button" className="cta-ghost" onClick={() => go('asked')}>Нужно уточнить снова</button>
          </>
        )}
        {issue.status === 'fixed' && (
          <>
            <button type="button" className="cta" onClick={() => go('closed')}>
              <Icon name="check" size={16} stroke={2.1} />
              Закрыть замечание
            </button>
            <button type="button" className="cta-ghost" onClick={() => go('open')}>Открыть заново</button>
          </>
        )}
        {issue.status === 'closed' && (
          <button type="button" className="cta-ghost solo" onClick={() => go('open')}>Открыть заново</button>
        )}

        <div className="foot-note">
          {issue.status === 'asked' && 'Ответ нужен, чтобы перейти к исправлению'}
          {issue.status === 'answered' && 'Опишите правку, чтобы закрыть замечание'}
          {issue.status === 'fixed' && 'Закройте замечание, когда правка согласована'}
          {issue.status === 'closed' && 'История замечания сохранена'}
        </div>
      </div>}
    </aside>
  );
}
