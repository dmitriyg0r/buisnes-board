import { isLinkable, projectNodes } from './bpmn';
import { sectionRef, type Issue, type Model } from './data';
import { INFO_SECTION, key } from './schema';

export interface Coverage {
  steps: { total: number; linked: number };
  sections: { total: number; linked: number };
}

/** Пункты, которые должны описывать шаги модели. Справочные (цель, участники) в проверке покрытия не участвуют. */
const allSections = (m: Model) =>
  m.docs.flatMap((d) => d.sections.filter((s) => m.meta[key.section(s.id)]?.coverage !== INFO_SECTION).map((s) => ({ ...s, docId: d.id, docTitle: d.title })));

export function coverage(model: Model): Coverage {
  const steps = projectNodes(model.processes).filter(isLinkable);
  const sections = allSections(model);
  const nodeIds = new Set(model.links.map((l) => l.nodeId));
  const secIds = new Set(model.links.map((l) => l.sectionId));
  return {
    steps: { total: steps.length, linked: steps.filter((n) => nodeIds.has(n.id)).length },
    sections: { total: sections.length, linked: sections.filter((s) => secIds.has(s.id)).length },
  };
}

/** Замечания, которые находятся без ИИ: шаг без пункта и пункт без шага. */
export function autoIssues(model: Model): Issue[] {
  const out: Issue[] = [];
  const nodeIds = new Set(model.links.map((l) => l.nodeId));
  const secIds = new Set(model.links.map((l) => l.sectionId));

  // без документов сверять шаги не с чем: замечаний о покрытии шагов нет
  if (model.docs.length) {
    for (const n of projectNodes(model.processes)) {
      if (!isLinkable(n) || nodeIds.has(n.id)) continue;
      const name = n.name || 'без названия';
      out.push({
        id: `auto-node-${n.id}`,
        auto: true,
        status: 'open',
        title: `Шаг «${name}» не описан в документах`,
        model: { nodeId: n.id, label: n.procTitle, step: `Шаг «${name}»` },
        summary: 'Для шага нет связи «Описывает» ни с одним пунктом документов.',
        question: `Какой пункт документа описывает шаг «${name}»?`,
      });
    }
  }

  // без моделей пункты не с чем сверять
  if (model.processes.length) {
    for (const s of allSections(model)) {
      if (secIds.has(s.id)) continue;
      const ref = sectionRef(s.title);
      out.push({
        id: `auto-sec-${s.id}`,
        auto: true,
        status: 'open',
        title: `Пункт ${ref} не отражён в модели`,
        doc: { sectionId: s.id, label: s.title },
        summary: `Для пункта документа «${s.docTitle}» нет связи «Описывает» ни с одним шагом модели.`,
        question: `Какой шаг модели отражает ${ref}?`,
      });
    }
  }
  return out;
}
