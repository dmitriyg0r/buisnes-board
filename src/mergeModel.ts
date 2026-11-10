import type { Model } from './data';
import { mergeDiagramSource } from './modeling/mergeSource';

/**
 * Трёхстороннее слияние модели доски: base — последняя синхронизированная версия,
 * local — то, что сейчас у пользователя, remote — свежая версия с сервера.
 * Правила для каждого объекта (по id) и каждого атрибута:
 *  - локально не менялось → берём серверное (в том числе удаление);
 *  - менялось только локально → берём локальное (в том числе удаление);
 *  - менялось и там и там → побеждает локальное, но если локально объект удалён, а на сервере
 *    изменён, объект остаётся (чужая правка важнее моего удаления);
 *  - для карточек meta атрибуты объекта сливаются по отдельности;
 *  - содержимое BPMN/EPC/UML сливается по ID элементов и отдельным свойствам XML/JSON.
 * Одновременная правка одного и того же свойства двумя людьми разрешается в пользу
 * того, чей клиент сливает последним. Небезопасное слияние диаграммы останавливает синхронизацию.
 */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeRecord<V>(base: Record<string, V>, local: Record<string, V>, remote: Record<string, V>, inner?: (b: V | undefined, l: V, r: V) => V): Record<string, V> {
  const out: Record<string, V> = {};
  const keys = new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(base)]);
  for (const k of keys) {
    const b = base[k], l = local[k], r = remote[k];
    const lc = !same(l, b), rc = !same(r, b);
    let v: V | undefined;
    if (!lc) v = r;
    else if (rc && l === undefined) v = r;
    else if (rc && inner && l !== undefined && r !== undefined) v = inner(b, l, r);
    else v = l;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

type WithId = { id: string };
function mergeList<T extends WithId>(base: T[], local: T[], remote: T[], fields = false, content?: (base: T | undefined, local: T, remote: T, merged: T) => T): T[] {
  const idx = (a: T[]) => Object.fromEntries(a.map((x) => [x.id, x])) as Record<string, T>;
  const merged = mergeRecord(idx(base), idx(local), idx(remote), fields
    ? (b, l, r) => {
      const merged = mergeRecord((b ?? {}) as Record<string, unknown>, l as Record<string, unknown>, r as Record<string, unknown>) as T;
      return content ? content(b, l, r, merged) : merged;
    }
    : undefined);
  // порядок: сначала как на сервере, затем новые локальные
  const order = [...remote.map((x) => x.id), ...local.map((x) => x.id)];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of order) if (!seen.has(id) && merged[id]) { seen.add(id); out.push(merged[id]); }
  return out;
}

export function mergeModel(base: Model, local: Model, remote: Model): Model {
  return {
    gateways: mergeList(base.gateways, local.gateways, remote.gateways),
    links: mergeList(base.links, local.links, remote.links),
    cardLinks: mergeList(base.cardLinks, local.cardLinks, remote.cardLinks),
    models: mergeList(base.models, local.models, remote.models, true, (b, l, r, merged) => ({ ...merged,
      source: b && l.notation === r.notation && b.notation === l.notation ? mergeDiagramSource(b.source, l.source, r.source, l.notation) : merged.source,
    })),
    processes: mergeList(base.processes, local.processes, remote.processes, true, (b, l, r, merged) => ({ ...merged,
      xml: b ? mergeDiagramSource(b.xml, l.xml, r.xml, 'bpmn') : merged.xml,
    })),
    docs: mergeList(base.docs, local.docs, remote.docs),
    htmlObjects: mergeList(base.htmlObjects, local.htmlObjects, remote.htmlObjects),
    sources: mergeList(base.sources, local.sources, remote.sources),
    meta: mergeRecord(base.meta, local.meta, remote.meta, (b, l, r) => mergeRecord(b ?? {}, l, r)),
  };
}
