import { applyGenerated, buildContext, GenError, streamGenerate, type Created, type Turn } from './ai';
import { planAiActions } from './aiCanvasTools';
import type { AiObservation, AiToolHost } from './aiToolContract';
import type { AiModel } from './settings';
import type { ModelApi } from './useModel';

export interface AgentResult {
  reply: string;
  refs: { procs: Created[]; docs: Created[]; updated: Created[] };
  observations: AiObservation[];
}
interface Options {
  prompt: string; model: AiModel; history: Turn[]; projectId: string; signal: AbortSignal; api: ModelApi;
  host: () => AiToolHost;
  onDelta: (text: string) => void;
  onRound?: (round: number) => void;
  onApplied?: () => void;
  generate?: typeof streamGenerate;
  render?: () => Promise<void>;
}

const nextRender = () => typeof requestAnimationFrame === 'function' ? new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) : Promise.resolve();

/** Ограниченный цикл чтения → проверка → применение. Действия вне каталога не исполняются. */
export async function runCanvasAgent(options: Options): Promise<AgentResult> {
  const { api, signal } = options;
  const generate = options.generate ?? streamGenerate;
  const render = options.render ?? nextRender;
  const observations: AiObservation[] = [];
  const refs: AgentResult['refs'] = { procs: [], docs: [], updated: [] };
  let aliases = new Map<string, string>();
  let lastError = '';
  const legacyDone = new Set<string>();
  const rememberRefs = (list: Created[], items: Created[]) => {
    for (const item of items) { const index = list.findIndex((x) => x.id === item.id && x.kind === item.kind); if (index < 0) list.push(item); else list[index] = item; }
  };

  for (let round = 0; round < 6; round++) {
    signal.throwIfAborted();
    options.onRound?.(round);
    const baseline = api.getModel();
    const history = observations.slice(-40);
    // Длинные успешные записи не нужно посылать повторно; их факты и ID остаются в журнале.
    for (const entry of history) if (!entry.action.tool.startsWith('read_')) {
      entry.action = { ...entry.action, arguments: Object.fromEntries(Object.entries(entry.action.arguments).map(([key, value]) => [key, typeof value === 'string' && value.length > 1000 ? `[уже применённый текст: ${value.length} символов]` : value])) };
    }
    while (history.length > 1 && new TextEncoder().encode(JSON.stringify(history)).length > 450_000) history.shift();
    const response = await generate(options.prompt, options.model, buildContext(baseline, options.host().snapshot()), options.history, (event) => { if (event.type === 'delta') options.onDelta(event.text); }, signal, options.projectId, history);
    signal.throwIfAborted();
    const actions = response.actions ?? [];
    const legacyKey = JSON.stringify({ processes: response.processes, documents: response.documents, updates: response.updates });
    const hasLegacy = !!(response.processes?.length || response.documents?.length || response.updates?.length) && !legacyDone.has(legacyKey);
    if (!actions.length && !hasLegacy) return { reply: response.reply.trim() || 'Готово.', refs, observations };

    const before = api.getModel();
    let plan;
    let legacy;
    try {
      if (hasLegacy && actions.some((a) => a.tool.startsWith('read_'))) throw new Error('Чтение и создание выполняются разными шагами');
      legacy = applyGenerated(before, hasLegacy ? response : { reply: '' });
      const proposalAliases = new Map(aliases);
      legacy.procs.forEach((item, i) => proposalAliases.set(response.processes?.[i]?.key ?? `p${i + 1}`, `proc:${item.id}`));
      legacy.docs.forEach((item, i) => proposalAliases.set(`doc${i + 1}`, `doc:${item.id}`));
      plan = planAiActions(legacy.model, actions, options.host().snapshot(), proposalAliases, baseline);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      observations.push({ action: { tool: 'validation', arguments: {} }, result: { ok: false, summary: 'Пакет изменений не применён', error: lastError } });
      continue;
    }

    if (legacy.model !== before || plan.changed) { api.apply(() => plan.model); options.onApplied?.(); }
    aliases = plan.aliases;
    if (hasLegacy) {
      legacyDone.add(legacyKey);
      rememberRefs(refs.procs, legacy.procs); rememberRefs(refs.docs, legacy.docs); rememberRefs(refs.updated, legacy.updated);
      observations.push({ action: { tool: 'legacy_generation', arguments: {} }, result: { ok: !legacy.missing, summary: `Созданы процессы: ${legacy.procs.length}, документы: ${legacy.docs.length}; изменено: ${legacy.updated.length}; не найдено: ${legacy.missing}`, data: { created: [...legacy.procs, ...legacy.docs], updated: legacy.updated } } });
    }
    rememberRefs(refs.updated, plan.refs.filter((item) => !refs.procs.some((p) => p.id === item.id) && !refs.docs.some((d) => d.id === item.id)));
    await render();
    for (const effect of plan.effects) {
      signal.throwIfAborted();
      try {
        const result = await options.host().execute(effect);
        plan.observations[effect.index].result = result;
        if (result.ok) options.onApplied?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        plan.observations[effect.index].result = { ok: false, summary: `Не выполнено: ${effect.tool}`, error: message };
        if (effect.tool === 'create_issue') { const key = plan.observations[effect.index].action.key; if (key) aliases.delete(key); }
      }
      await render();
    }
    observations.push(...plan.observations);
    const failures = plan.observations.filter((o) => !o.result.ok);
    if (failures.length) { lastError = failures.map((o) => o.result.error ?? o.result.summary).join('; '); continue; }
    if (actions.some((a) => a.tool.startsWith('read_'))) continue;
    if (legacy.missing) { lastError = `Не найдено объектов: ${legacy.missing}`; continue; }
    // Итоговая реплика строится уже по фактическим результатам, а не по обещанию перед выполнением.
    if (actions.length && round < 5) continue;
    return { reply: actions.length ? plan.observations.map((o) => o.result.summary).join('. ') : response.reply.trim() || 'Готово.', refs, observations };
  }
  if (!observations.some((o) => o.result.ok && !o.action.tool.startsWith('read_'))) throw new GenError(`Не удалось выполнить запрос за 6 шагов.${lastError ? ` ${lastError}` : ' Уточните, с каким объектом нужно работать.'}`);
  return { reply: `Запрос выполнен частично.${lastError ? ` ${lastError}` : ' Достигнут лимит шагов.'} Уже выполненные действия остаются на доске.`, refs, observations };
}
