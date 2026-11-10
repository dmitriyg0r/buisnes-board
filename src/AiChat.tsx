import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GenError, type Created, type Turn } from './ai';
import { runCanvasAgent } from './aiCanvasAgent';
import type { AiToolHost } from './aiToolContract';
import { HttpError } from './api';
import { AiProgress, beginDraft, useDraft } from './AiDraft';
import { Icon } from './Icon';
import { aiModels, type AiModel } from './settings';
import type { ModelApi } from './useModel';
import type { Presence } from './presence';

/** Что ИИ сделал на доске: созданное и изменённое. */
interface Refs {
  procs: Created[];
  docs: Created[];
  updated: Created[];
}

const CHIPS_SHOWN = 8;

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** error: сбой генерации; note: служебная пометка (например, отмена). В историю для модели не попадают. */
  tone?: 'error' | 'note';
  refs?: Refs;
  tools?: { ok: boolean; summary: string }[];
}

const MAX_MSGS = 100;
const HISTORY_TURNS = 10;
const SUGGEST = ['Создай процесс согласования договора и регламент', 'Создай интерактивный HTML-калькулятор стоимости', 'Проверь связи шагов с документами и замечания'];

/* История чата хранится в браузере: она нужна только тому, кто её ведёт. Хранилище может быть недоступно. */
const msgKey = (projectId: string) => `bb.chat.${projectId}`;
const OPEN_KEY = 'bb.chat.open';

const isMsg = (m: unknown): m is Msg => {
  const x = m as Msg;
  return !!x && typeof x.id === 'string' && (x.role === 'user' || x.role === 'assistant') && typeof x.text === 'string';
};
const goodRefs = (r: unknown): r is Refs => {
  const x = r as Refs;
  return !!x && Array.isArray(x.procs) && Array.isArray(x.docs) && Array.isArray(x.updated);
};
function loadMsgs(projectId: string): Msg[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(msgKey(projectId)) ?? '[]');
    // ссылки в формате прежней версии (один процесс и один документ) отбрасываем, текст сообщения остаётся
    return Array.isArray(v) ? v.filter(isMsg).map((m) => (m.refs && !goodRefs(m.refs) ? { ...m, refs: undefined } : m)) : [];
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

const names = (list: Created[]) => list.map((c) => `«${c.title}»`).join(', ');

/** Последние реплики для модели; про сделанное на доске добавляем пометку, чтобы она не делала то же самое заново. */
function toTurns(msgs: Msg[]): Turn[] {
  return msgs
    .filter((m) => !m.tone)
    .slice(-HISTORY_TURNS)
    .map((m) => {
      const r = m.refs;
      const done = r
        ? [r.procs.length ? `построены процессы ${names(r.procs)}` : '', r.docs.length ? `созданы документы ${names(r.docs)}` : '', r.updated.length ? `изменены ${names(r.updated)}` : ''].filter(Boolean).join('; ')
        : '';
      return { role: m.role, text: done ? `${m.text} [на доске: ${done}]` : m.text };
    });
}

const errText = (err: unknown) => {
  if (err instanceof GenError) return err.message;
  if (err instanceof HttpError) return err.detail ?? 'Нет связи с сервером';
  // сеть оборвалась (fetch бросает TypeError), всё остальное наша ошибка: не выдаём её за проблему связи
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) return 'Нет связи с сервером';
  console.error(err);
  return 'Не удалось применить ответ ИИ. Попробуйте ещё раз.';
};

/* ---------- сообщения ---------- */

function Bubble({ m, onFocus }: { m: Msg; onFocus: (cardId: string) => void }) {
  const items = m.refs ? [...m.refs.procs, ...m.refs.docs, ...m.refs.updated] : [];
  return (
    <div className={`ai-msg ${m.role}${m.tone ? ` ${m.tone}` : ''}`} role={m.tone === 'error' ? 'alert' : undefined}>
      <p className="ai-text">{m.text}</p>
      {items.length > 0 && (
        <div className="ai-chips">
          {items.slice(0, CHIPS_SHOWN).map((c) => (
            <button key={`${c.kind}:${c.id}`} type="button" className="ai-chip" onClick={() => onFocus(`${c.kind}:${c.id}`)} title="Показать на доске">
              <Icon name={(c.kind === 'proc' || c.kind === 'model') ? 'model' : c.kind === 'html' ? 'code' : c.kind === 'gw' ? 'gateway' : 'file'} size={13} />
              <span>{c.title}</span>
            </button>
          ))}
          {items.length > CHIPS_SHOWN && <span className="ai-more">и ещё {items.length - CHIPS_SHOWN}</span>}
        </div>
      )}
      {!!m.tools?.length && <details className="ai-tool-log"><summary>Действия на доске · {m.tools.length}</summary><ul>{m.tools.map((tool, i) => <li key={i} className={tool.ok ? '' : 'failed'}><Icon name={tool.ok ? 'check' : 'close'} size={12} /><span>{tool.summary}</span></li>)}</ul></details>}
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
  /** ИИ-генерация коллег показывается на доске как собственная */
  presence?: Presence;
  api: ModelApi;
  aiModel: AiModel;
  onModel: (m: AiModel) => void;
  /** показать на экране место будущих карточек */
  onReveal: () => void;
  /** подвести камеру к карточке: proc:<id> или doc:<id> */
  onFocusCard: (cardId: string) => void;
  tools: AiToolHost;
  collapseRequest?: number;
}

export function AiChat({ projectId, presence, api, aiModel, onModel, onReveal, onFocusCard, tools, collapseRequest = 0 }: Props) {
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const [msgs, setMsgs] = useState<Msg[]>(() => loadMsgs(projectId));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  // коллега просит ИИ построить процесс: его черновик растёт и у нас (если мы сами не генерируем)
  useEffect(() => {
    let draft: ReturnType<typeof beginDraft> | null = null;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { clearTimeout(guard); draft?.end(); draft = null; };
    const off = presence?.onAi((e) => {
      if (busyRef.current) return;
      if (e.k === 'end') { stop(); return; }
      if (!draft) draft = beginDraft(e.name);
      if (e.k === 'delta') draft.push(e.text);
      // если поток оборвался без «конца», черновик не должен висеть вечно
      clearTimeout(guard);
      guard = setTimeout(stop, 60_000);
    });
    return () => { off?.(); stop(); };
  }, [presence?.onAi]);
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
  useEffect(() => { if (collapseRequest) setOpen(false); }, [collapseRequest]);

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
    const label = aiModels.find((m) => m.id === aiModel)?.label ?? 'ИИ';
    let draft = beginDraft(label, onReveal);
    let applied = false;
    let openedDialog = false;
    try {
      const result = await runCanvasAgent({ prompt, model: aiModel, history, projectId, api, signal: ctl.signal,
        host: () => ({ snapshot: () => toolsRef.current.snapshot(), execute: async (effect) => {
          if (effect.tool === 'set_view' && typeof effect.arguments.chat === 'boolean') {
            setOpen(effect.arguments.chat);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          const result = await toolsRef.current.execute(effect);
          if (result.ok && (effect.tool === 'open_editor' || effect.tool === 'show_properties')) openedDialog = true;
          return result;
        } }),
        onDelta: (text) => draft.push(text),
        onRound: (round) => { if (round) { draft.end(); draft = beginDraft(label, onReveal); } },
        onApplied: () => { applied = true; },
      });
      const refs = result.refs.procs.length || result.refs.docs.length || result.refs.updated.length ? result.refs : undefined;
      setMsgs((m) => [...m, mk('assistant', result.reply, { refs, tools: result.observations.filter((o) => o.action.tool !== 'validation').map((o) => ({ ok: o.result.ok, summary: o.result.ok ? o.result.summary : o.result.error ?? o.result.summary })) })]);
    } catch (err) {
      setMsgs((m) => [...m, ctl.signal.aborted ? mk('assistant', applied ? 'Остановлено. Уже выполненные действия остаются на доске.' : 'Генерация отменена.', { tone: 'note' }) : mk('assistant', errText(err) + (applied ? ' Уже выполненные действия остаются на доске.' : ''), { tone: 'error' })]);
    }
    draft.end();
    abort.current = null;
    setBusy(false);
    if (!openedDialog) field.current?.focus();
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
                <p>Работаю со всеми объектами канваса: BPMN, документами, HTML, источниками, связями, свойствами, замечаниями и видом доски. Опишите, что нужно сделать.</p>
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
          placeholder="Что сделать на доске?"
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
