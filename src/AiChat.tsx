import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyGenerated, buildContext, GenError, streamGenerate, type Applied, type Turn } from './ai';
import { HttpError } from './api';
import { AiProgress, beginDraft, useDraft } from './AiDraft';
import { Icon } from './Icon';
import { aiModels, type AiModel } from './settings';
import type { ModelApi } from './useModel';

interface Refs {
  procId?: string;
  procTitle?: string;
  docId?: string;
  docTitle?: string;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** error: сбой генерации; note: служебная пометка (например, отмена). В историю для модели не попадают. */
  tone?: 'error' | 'note';
  refs?: Refs;
}

const MAX_MSGS = 100;
const HISTORY_TURNS = 10;
const SUGGEST = ['Согласование договора с юристом и финансами', 'Приём нового сотрудника на работу', 'Обработка обращения клиента в поддержку'];

/* История чата хранится в браузере: она нужна только тому, кто её ведёт. Хранилище может быть недоступно. */
const msgKey = (projectId: string) => `bb.chat.${projectId}`;
const OPEN_KEY = 'bb.chat.open';

const isMsg = (m: unknown): m is Msg => {
  const x = m as Msg;
  return !!x && typeof x.id === 'string' && (x.role === 'user' || x.role === 'assistant') && typeof x.text === 'string';
};
function loadMsgs(projectId: string): Msg[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(msgKey(projectId)) ?? '[]');
    return Array.isArray(v) ? v.filter(isMsg) : [];
  } catch {
    return [];
  }
}
function saveMsgs(projectId: string, msgs: Msg[]) {
  try {
    if (msgs.length) localStorage.setItem(msgKey(projectId), JSON.stringify(msgs.slice(-MAX_MSGS)));
    else localStorage.removeItem(msgKey(projectId));
  } catch {
    /* ignore */
  }
}
const loadOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};

const mk = (role: Msg['role'], text: string, extra: Partial<Msg> = {}): Msg => ({ id: Math.random().toString(36).slice(2, 10), role, text, at: Date.now(), ...extra });

/** Последние реплики для модели; про построенное на доске добавляем пометку, чтобы она не строила то же самое заново. */
function toTurns(msgs: Msg[]): Turn[] {
  return msgs
    .filter((m) => !m.tone)
    .slice(-HISTORY_TURNS)
    .map((m) => {
      const built = m.refs?.procTitle ? ` [на доске построен процесс «${m.refs.procTitle}»${m.refs.docTitle ? ` и документ «${m.refs.docTitle}»` : ''}]` : '';
      return { role: m.role, text: m.text + built };
    });
}

const errText = (err: unknown) => (err instanceof GenError ? err.message : err instanceof HttpError && err.detail ? err.detail : 'Нет связи с сервером');

/* ---------- сообщения ---------- */

function Bubble({ m, onFocus }: { m: Msg; onFocus: (cardId: string) => void }) {
  return (
    <div className={`ai-msg ${m.role}${m.tone ? ` ${m.tone}` : ''}`} role={m.tone === 'error' ? 'alert' : undefined}>
      <p className="ai-text">{m.text}</p>
      {m.refs && (m.refs.procId || m.refs.docId) && (
        <div className="ai-chips">
          {m.refs.procId && (
            <button type="button" className="ai-chip" onClick={() => onFocus(`proc:${m.refs!.procId}`)} title="Показать на доске">
              <Icon name="model" size={13} />
              <span>{m.refs.procTitle}</span>
            </button>
          )}
          {m.refs.docId && (
            <button type="button" className="ai-chip" onClick={() => onFocus(`doc:${m.refs!.docId}`)} title="Показать на доске">
              <Icon name="file" size={13} />
              <span>{m.refs.docTitle}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Ответ, который пишется прямо сейчас: реплика печатается, под ней этапы работы. */
function LiveBubble({ onCancel }: { onCancel: () => void }) {
  const d = useDraft();
  const ref = useRef<HTMLDivElement>(null);
  const tick = d ? d.plan.reply.length + d.plan.nodes.length + d.plan.sections.length : 0;
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [tick]);
  if (!d) return null;
  return (
    <div className="ai-msg assistant live" ref={ref}>
      {d.plan.reply && <p className="ai-text">{d.plan.reply}</p>}
      <AiProgress onCancel={onCancel} />
    </div>
  );
}

interface Props {
  projectId: string;
  api: ModelApi;
  aiModel: AiModel;
  onModel: (m: AiModel) => void;
  /** показать на экране место будущих карточек */
  onReveal: () => void;
  /** подвести камеру к карточке: proc:<id> или doc:<id> */
  onFocusCard: (cardId: string) => void;
}

export function AiChat({ projectId, api, aiModel, onModel, onReveal, onFocusCard }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>(() => loadMsgs(projectId));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpenState] = useState(loadOpen);
  const abort = useRef<AbortController | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => saveMsgs(projectId, msgs), [projectId, msgs]);
  // длинное сообщение растит поле вверх, но не больше четырёх строк
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [text]);
  // к новому сообщению прокручиваем сами
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [msgs.length, open]);

  const send = async (raw?: string) => {
    const prompt = (raw ?? text).trim();
    if (!prompt || busy) return;
    const history = toTurns(msgs);
    setMsgs((m) => [...m, mk('user', prompt)]);
    setText('');
    setOpen(true);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const draft = beginDraft(aiModels.find((m) => m.id === aiModel)?.label ?? 'ИИ', onReveal);
    try {
      const r = await streamGenerate(prompt, aiModel, buildContext(api.model), history, (ev) => ev.type === 'delta' && draft.push(ev.text), ctl.signal);
      let applied = null as Applied | null;
      if (r.process) {
        api.apply((m) => {
          applied = applyGenerated(m, r);
          return applied.model;
        });
      }
      const refs: Refs | undefined = applied ? { procId: applied.procId, procTitle: r.process?.title, docId: applied.docId, docTitle: r.document?.title } : undefined;
      setMsgs((m) => [...m, mk('assistant', r.reply.trim() || (refs ? 'Готово.' : 'Ответа нет, попробуйте переформулировать.'), { refs })]);
    } catch (err) {
      setMsgs((m) => [...m, ctl.signal.aborted ? mk('assistant', 'Генерация отменена.', { tone: 'note' }) : mk('assistant', errText(err), { tone: 'error' })]);
    }
    draft.end();
    abort.current = null;
    setBusy(false);
    field.current?.focus();
  };

  const clear = () => {
    if (busy) return;
    setMsgs([]);
  };

  return (
    <div className={`ai-bar${open ? ' open' : ''}`} onContextMenu={(e) => e.stopPropagation()}>
      {open && (
        <>
          <div className="ai-head">
            <span className="ai-head-title">
              <Icon name="sparkle" size={14} /> Чат с ИИ
            </span>
            <span className="ai-head-actions">
              {msgs.length > 0 && (
                <button type="button" className="ai-ic" title="Очистить чат" aria-label="Очистить чат" disabled={busy} onClick={clear}>
                  <Icon name="trash" size={15} />
                </button>
              )}
            </span>
          </div>
          <div className="ai-log" ref={log} role="log" aria-label="История чата с ИИ" aria-live="polite">
            {msgs.length === 0 && !busy && (
              <div className="ai-empty">
                <p>Опишите процесс, и я построю схему и регламент. Можно задавать вопросы и уточнять сказанное.</p>
                <div className="ai-chips">
                  {SUGGEST.map((s) => (
                    <button key={s} type="button" className="ai-chip" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => (
              <Bubble key={m.id} m={m} onFocus={onFocusCard} />
            ))}
            {busy && <LiveBubble onCancel={() => abort.current?.abort()} />}
          </div>
        </>
      )}
      <form
        className="ai-field"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button type="button" className="ai-toggle" aria-expanded={open} aria-label={open ? 'Свернуть чат' : 'Развернуть чат'} title={open ? 'Свернуть чат' : 'Развернуть чат'} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronUp'} size={16} />
        </button>
        <textarea
          ref={field}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter отправляет, Shift+Enter переносит строку
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Опишите процесс или задайте вопрос"
          aria-label="Сообщение ИИ"
          maxLength={4000}
        />
        <select className="ai-model" value={aiModel} onChange={(e) => onModel(e.target.value as AiModel)} aria-label="Модель ИИ" disabled={busy}>
          {aiModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button type="submit" className="ai-send" disabled={busy || !text.trim()} title={busy ? 'ИИ отвечает…' : 'Отправить'} aria-label="Отправить">
          <Icon name="arrowUp" size={16} />
        </button>
      </form>
      {/* свёрнутый чат всё равно показывает, что ИИ работает */}
      {!open && busy && <AiProgress onCancel={() => abort.current?.abort()} />}
    </div>
  );
}
