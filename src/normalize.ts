import { blankXml } from './bpmn';
import type { CardLink, Doc, Gateway, DocLink, Model, Process } from './data';
import { sectionTitles } from './markdown';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const rid = (p: string) => p + Math.random().toString(36).slice(2, 8);

/**
 * Приводит модель из хранилища или с сервера к текущему виду. Старые проекты хранили одну модель (`process`)
 * и один документ с готовыми пунктами (`doc`): они превращаются в первую модель и первый документ, связи сохраняются.
 */
export function normalizeModel(m: Partial<Model> | Raw): Model {
  const raw = m as Raw;

  let legacyProcess = false;
  const processes: Process[] = Array.isArray(raw.processes)
    ? raw.processes.map((p: Raw) => ({ id: p.id || rid('p'), title: p.title || 'Модель процесса', xml: p.xml || blankXml(p.title || 'Модель процесса') }))
    : raw.process
      ? ((legacyProcess = true),
        [{ id: 'main', title: raw.process.title || 'Модель процесса', xml: raw.process.xml || blankXml(raw.process.title || 'Модель процесса') }])
      : [];

  const docs: Doc[] = Array.isArray(raw.docs)
    ? raw.docs.map((d: Raw) => ({ id: d.id || rid('d'), title: d.title || 'Документ', markdown: d.markdown ?? '', sections: Array.isArray(d.sections) ? d.sections : [] }))
    : raw.doc
      ? [
          {
            id: 'main',
            title: raw.doc.title || 'Документ',
            sections: (raw.doc.sections ?? []).map((s: Raw) => ({ id: s.id, title: s.title })),
            markdown:
              `# ${raw.doc.title || 'Документ'}\n\n` + (raw.doc.sections ?? []).map((s: Raw) => `## ${s.title}\n\n${s.text ?? ''}\n`).join('\n'),
          },
        ]
      : [];
  // у документа без списка пунктов (например, импортированного) пункты берутся из заголовков
  for (const d of docs) if (!d.sections.length) d.sections = sectionTitles(d.markdown).map((title, i) => ({ id: `${d.id}-${i}`, title }));

  const rename = (id: string) => (id === 'model' ? 'proc:main' : id === 'doc' ? 'doc:main' : id);
  const gateways: Gateway[] = Array.isArray(raw.gateways)
    ? raw.gateways.map((g: Raw) => ({ id: g.id || rid('g'), label: typeof g.label === 'string' ? g.label : '' }))
    : [];
  return {
    gateways,
    links: ((Array.isArray(raw.links) ? raw.links : []) as DocLink[]).map((l) => (legacyProcess && !String(l.nodeId).includes(':') ? { ...l, nodeId: `main:${l.nodeId}` } : l)),
    cardLinks: ((Array.isArray(raw.cardLinks) ? raw.cardLinks : []) as CardLink[]).map((l) => ({ ...l, from: rename(l.from), to: rename(l.to) })),
    processes,
    docs,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
  };
}
