import { blankXml, isLinkable, projectNodes } from './bpmn';
import { emptyModel, type CardLink, type Issue, type Model } from './data';
import { starterHtml } from './html';
import { reconcileSections, sectionTitles } from './markdown';
import { bpmnCollaborationFacade as bpmn } from './modeling/bpmnCollaborationFacade';
import { docFields, fileFields, INFO_SECTION, modelFields, nodeFields, sectionFields, type FieldDef } from './schema';
import { canvasCardIds, canvasObject, canvasOverview, canvasTitle, readCanvasObject } from './aiCanvasContext';
import { validateAiActions, type AiAction, type AiEffect, type AiEnvironment, type AiObservation, type CanvasRef } from './aiToolContract';

export interface AiPlan {
  model: Model; changed: boolean; observations: AiObservation[]; effects: AiEffect[]; aliases: Map<string, string>; refs: CanvasRef[];
}
const uid = (prefix: string) => prefix + crypto.randomUUID();
const str = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`Не указано строковое поле ${key}`);
  return value;
};
const number = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Не указано число ${key}`);
  return value;
};
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const titleOf = (args: Record<string, unknown>) => str(args, 'title').trim() || 'Без названия';
const objectPrefix = { process: 'proc', document: 'doc', html: 'html', source: 'src', gateway: 'gw' } as const;

/** Полная предварительная проверка на копии: ошибочная команда не оставляет половину изменений. */
export function planAiActions(input: Model, actions: AiAction[], env: AiEnvironment, previousAliases = new Map<string, string>(), baseline: Model = input): AiPlan {
  validateAiActions(actions);
  let model: Model = structuredClone(input);
  const aliases = new Map(previousAliases);
  const observations: AiObservation[] = [], effects: AiEffect[] = [], refs: CanvasRef[] = [];
  const issues: Issue[] = structuredClone(env.issues);
  const checked = new Set<string>();
  const resolve = (value: string): string => {
    if (!value.startsWith('$')) return value;
    const section = /^\$([A-Za-z][A-Za-z0-9_-]*)\/section\/(\d+)$/.exec(value);
    if (section) {
      const card = aliases.get(section[1]);
      const doc = card && canvasObject(model, card);
      const item = doc && 'sections' in doc && doc.sections[Number(section[2]) - 1];
      if (!item) throw new Error(`Не найден пункт ${value}`);
      return item.id;
    }
    const id = aliases.get(value.slice(1));
    if (!id) throw new Error(`Не найден результат команды ${value}`);
    return id;
  };
  const card = (value: string): string => {
    const id = resolve(value);
    if (!canvasObject(model, id)) throw new Error(`На доске нет объекта ${id}`);
    return id;
  };
  const bind = (key: string | undefined, id: string) => {
    if (!key) return;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key)) throw new Error('Некорректный key результата');
    if (aliases.has(key) && aliases.get(key) !== id) throw new Error(`Ключ ${key} уже используется`);
    aliases.set(key, id);
  };
  const touched = (id: string) => {
    const item = canvasObject(model, id)!;
    const at = id.indexOf(':');
    const ref = { id: id.slice(at + 1), kind: id.slice(0, at) as CanvasRef['kind'], title: canvasTitle(item) };
    const existing = refs.findIndex((r) => r.id === ref.id && r.kind === ref.kind);
    if (existing < 0) refs.push(ref); else refs[existing] = ref;
  };
  const unchanged = (id: string) => {
    if (checked.has(id)) return;
    const old = canvasObject(baseline, id), current = canvasObject(input, id);
    if (old && JSON.stringify(old) !== JSON.stringify(current)) throw new Error(`Объект ${id} изменился во время генерации. Прочитай свежую версию и сохрани чужие изменения.`);
    checked.add(id);
  };
  const cleanReferences = () => {
    const cards = new Set(canvasCardIds(model));
    const sections = new Set(model.docs.flatMap((d) => d.sections.map((s) => s.id)));
    const nodes = new Set(projectNodes(model.processes).map((n) => n.id));
    model.cardLinks = model.cardLinks.filter((l) => cards.has(l.from) && cards.has(l.to));
    model.links = model.links.filter((l) => sections.has(l.sectionId) && nodes.has(l.nodeId));
    for (const [key, values] of Object.entries(model.meta)) {
      if (key === 'layout:pos' || key === 'layout:size') {
        model.meta[key] = Object.fromEntries(Object.entries(values).filter(([id]) => cards.has(id)));
      } else if ((key.startsWith('card:') && !cards.has(key.slice(5))) || (key.startsWith('section:') && !sections.has(key.slice(8))) || (key.startsWith('node:') && !nodes.has(key.slice(5)))) delete model.meta[key];
    }
  };
  const replaceMarkdown = (doc: Model['docs'][number], markdown: string, mode?: unknown) => {
    const old = new Set(doc.sections.map((s) => s.id));
    doc.markdown = markdown;
    doc.sections = reconcileSections(doc.sections, sectionTitles(markdown));
    for (const sec of doc.sections) if (mode || !old.has(sec.id)) model.meta[`section:${sec.id}`] = { ...model.meta[`section:${sec.id}`], coverage: mode === 'process' ? 'Описывает шаги модели' : INFO_SECTION };
    cleanReferences();
  };
  const validateXml = (xml: string) => {
    if (/<!DOCTYPE/i.test(xml)) throw new Error('BPMN не должен содержать DOCTYPE');
    const result = bpmn.read(xml);
    if (result.readOnlyReason) throw new Error(result.readOnlyReason);
  };
  const target = (type: string, value: string): string => {
    const id = resolve(value);
    if (type === 'card') return card(id);
    if (type === 'section' && model.docs.some((d) => d.sections.some((s) => s.id === id))) return id;
    if (type === 'node' && projectNodes(model.processes).some((n) => n.id === id)) return id;
    throw new Error(`Не найден ${type}: ${id}`);
  };
  const findIssue = (value: string) => {
    const issue = issues.find((i) => i.id === resolve(value));
    if (!issue) throw new Error(`Не найдено замечание ${value}`);
    return issue;
  };
  const fillIssue = (issue: Issue, args: Record<string, unknown>) => {
    const previous = { status: issue.status, answer: issue.answer, resolution: issue.resolution };
    for (const key of ['title', 'summary', 'question', 'answer', 'resolution', 'status'] as const) if (args[key] !== undefined) (issue as unknown as Record<string, unknown>)[key] = args[key];
    if (!issue.title.trim()) throw new Error('У замечания нет заголовка');
    if (args.nodeId !== undefined) {
      const id = target('node', str(args, 'nodeId')), node = projectNodes(model.processes).find((n) => n.id === id)!;
      issue.model = { nodeId: id, label: node.procTitle, step: node.name };
    }
    if (args.sectionId !== undefined) {
      const id = target('section', str(args, 'sectionId'));
      issue.doc = { sectionId: id, label: model.docs.flatMap((d) => d.sections).find((s) => s.id === id)!.title };
    }
    if (args.sourceId !== undefined) {
      let id = resolve(str(args, 'sourceId')); if (id.startsWith('src:')) id = id.slice(4);
      const source = model.sources.find((s) => s.id === id);
      if (!source) throw new Error('Источник замечания не найден');
      issue.basis = { sourceId: id, source: source.name, fragment: '', quote: '' };
    }
    if (!issue.history?.length || previous.status !== issue.status || previous.answer !== issue.answer || previous.resolution !== issue.resolution) issue.history = [...(issue.history ?? []), { status: issue.status, at: new Date().toISOString(), note: issue.answer || issue.resolution }];
  };

  for (const [index, action] of actions.entries()) {
    const args = structuredClone(action.arguments);
    let data: unknown;
    let summary = aiToolCatalogName(action.tool);
    const effect = (arguments_: Record<string, unknown>) => effects.push({ tool: action.tool, arguments: structuredClone(arguments_), index });
    try {
      switch (action.tool) {
        case 'read_canvas': {
          const overview = canvasOverview(model, env), offset = Math.round(Number(args.offset ?? 0)), limit = Math.round(Number(args.limit ?? 40));
          const count = Math.max(overview.objects.length, overview.issues.length, overview.cardLinks.length, overview.sectionLinks.length);
          data = { ...overview, objects: overview.objects.slice(offset, offset + limit), issues: overview.issues.slice(offset, offset + limit), cardLinks: overview.cardLinks.slice(offset, offset + limit), sectionLinks: overview.sectionLinks.slice(offset, offset + limit), offset, nextOffset: Math.min(count, offset + limit), truncated: offset + limit < count, totals: { objects: overview.objects.length, issues: overview.issues.length, cardLinks: overview.cardLinks.length, sectionLinks: overview.sectionLinks.length } };
          break;
        }
        case 'read_issue': data = findIssue(str(args, 'id')); break;
        case 'read_object': data = readCanvasObject(model, card(str(args, 'id')), Math.round(Number(args.offset ?? 0)), Math.round(Number(args.limit ?? 12000))); break;
        case 'create_object': {
          if (action.key && aliases.has(action.key)) {
            const id = card(`$${action.key}`); data = { id, alreadyCreated: true }; summary = 'Объект уже создан'; break;
          }
          const kind = str(args, 'kind') as keyof typeof objectPrefix, id = uid(objectPrefix[kind]), title = titleOf(args);
          const ref = `${objectPrefix[kind]}:${id}`;
          if (kind === 'process') { const xml = typeof args.xml === 'string' ? args.xml : blankXml(title); validateXml(xml); model.processes.push({ id, title, xml }); }
          else if (kind === 'document') {
            const doc = { id, title, markdown: '', sections: [] as Model['docs'][number]['sections'] };
            model.docs.push(doc); replaceMarkdown(doc, typeof args.markdown === 'string' ? args.markdown : `# ${title}\n\n`, args.sectionMode);
          } else if (kind === 'html') model.htmlObjects.push({ id, title, html: typeof args.html === 'string' ? args.html : starterHtml(title) });
          else if (kind === 'source') model.sources.push({ id, name: title, ext: args.ext === 'PDF' ? 'PDF' : 'DOCX', pages: Math.round(Number(args.pages ?? 1)) });
          else model.gateways.push({ id, label: title });
          bind(action.key, ref); touched(ref); data = { id: ref, ...('sections' in canvasObject(model, ref)! ? { sections: model.docs.find((d) => d.id === id)!.sections } : {}) };
          summary = `Создан объект «${title}»`; break;
        }
        case 'update_object': {
          const id = card(str(args, 'id')), item = canvasObject(model, id)!;
          unchanged(id);
          const contentFields = ['markdown', 'html', 'xml', 'ext', 'pages', 'append', 'sectionMode'].filter((key) => own(args, key));
          const allowed = 'markdown' in item ? ['markdown', 'append', 'sectionMode'] : 'html' in item ? ['html'] : 'xml' in item ? ['xml'] : 'ext' in item ? ['ext', 'pages'] : [];
          if (contentFields.some((key) => !allowed.includes(key))) throw new Error('Поле не соответствует типу объекта');
          if (own(args, 'markdown') && own(args, 'append')) throw new Error('Выбери замену Markdown или дописывание, а не оба сразу');
          if (typeof args.title === 'string') {
            const title = titleOf(args);
            if ('title' in item) item.title = title; else if ('name' in item) item.name = title; else item.label = title;
          }
          if ('markdown' in item) {
            let markdown = item.markdown;
            if (typeof args.markdown === 'string') markdown = args.markdown;
            else if (typeof args.append === 'string') markdown = `${markdown.trimEnd()}\n\n${args.append}\n`;
            else if (typeof args.title === 'string' && markdown.startsWith('# ')) markdown = `# ${item.title}` + markdown.slice(markdown.indexOf('\n') < 0 ? markdown.length : markdown.indexOf('\n'));
            replaceMarkdown(item, markdown, args.sectionMode);
          } else if ('html' in item && typeof args.html === 'string') item.html = args.html;
          else if ('xml' in item && typeof args.xml === 'string') { validateXml(args.xml); item.xml = args.xml; cleanReferences(); }
          else if ('ext' in item) { if (args.ext) item.ext = args.ext as 'PDF' | 'DOCX'; if (args.pages !== undefined) item.pages = Math.round(number(args, 'pages')); }
          touched(id); data = { id }; summary = `Обновлён объект «${canvasTitle(item)}»`; break;
        }
        case 'delete_objects': {
          const ids = (args.ids as string[]).map(card); ids.forEach(unchanged);
          const gone = new Set(ids);
          model.processes = model.processes.filter((p) => !gone.has(`proc:${p.id}`));
          model.docs = model.docs.filter((d) => !gone.has(`doc:${d.id}`));
          model.htmlObjects = model.htmlObjects.filter((h) => !gone.has(`html:${h.id}`));
          model.sources = model.sources.filter((s) => !gone.has(`src:${s.id}`));
          model.gateways = model.gateways.filter((g) => !gone.has(`gw:${g.id}`));
          cleanReferences(); data = { ids }; summary = `Удалено объектов: ${ids.length}`; break;
        }
        case 'set_layout': {
          for (const entry of args.objects as Record<string, unknown>[]) {
            const id = card(str(entry, 'id'));
            if (own(entry, 'x') !== own(entry, 'y') || own(entry, 'width') !== own(entry, 'height')) throw new Error('Положение и размер задаются парами');
            if (own(entry, 'x')) model.meta['layout:pos'] = { ...model.meta['layout:pos'], [id]: `${Math.round(number(entry, 'x'))},${Math.round(number(entry, 'y'))}` };
            if (own(entry, 'width')) {
              if (id.startsWith('src:')) throw new Error('Карточка источника имеет фиксированный размер');
              const min = id.startsWith('gw:') ? [96, 96] : id.startsWith('proc:') ? [320, 240] : [240, 200];
              if (number(entry, 'width') < min[0] || number(entry, 'height') < min[1]) throw new Error('Размер карточки меньше допустимого');
              model.meta['layout:size'] = { ...model.meta['layout:size'], [id]: `${Math.round(number(entry, 'width'))},${Math.round(number(entry, 'height'))}` };
            }
            touched(id);
          }
          break;
        }
        case 'set_properties': {
          const type = str(args, 'targetType'), id = target(type, str(args, 'id'));
          let fields: FieldDef[];
          if (type === 'section') fields = sectionFields;
          else if (type === 'node') fields = nodeFields[projectNodes(model.processes).find((n) => n.id === id)!.kind];
          else fields = id.startsWith('proc:') ? modelFields : id.startsWith('src:') ? fileFields : id.startsWith('gw:') ? [] : docFields;
          const metaKey = `${type}:${id}`, values = args.values as Record<string, string | null>;
          model.meta[metaKey] = { ...model.meta[metaKey] };
          for (const [key, value] of Object.entries(values)) {
            const field = fields.find((f) => f.key === key);
            if (!field || (value !== null && field.options && !field.options.includes(value))) throw new Error(`Недопустимый атрибут или значение: ${key}`);
            if (value === null) delete model.meta[metaKey][key]; else model.meta[metaKey][key] = value;
          }
          data = { targetType: type, id }; break;
        }
        case 'connect_cards':
        case 'update_card_link': {
          let link: CardLink;
          if (action.tool === 'connect_cards') {
            const from = card(str(args, 'from')), to = card(str(args, 'to'));
            link = model.cardLinks.find((l) => l.from === from && l.to === to) ?? { id: uid('c'), from, to, label: '' };
            if (!model.cardLinks.includes(link)) model.cardLinks.push(link);
          } else { const id = resolve(str(args, 'id')); const found = model.cardLinks.find((l) => l.id === id); if (!found) throw new Error('Связь не найдена'); link = found; }
          for (const key of ['from', 'to'] as const) if (args[key] !== undefined) link[key] = card(str(args, key));
          if (link.from === link.to) throw new Error('Нельзя связать карточку с собой');
          if (model.cardLinks.some((l) => l.id !== link.id && l.from === link.from && l.to === link.to)) throw new Error('Такая связь уже существует');
          for (const key of ['label', 'fromSide', 'toSide', 'fromOffset', 'toOffset', 'routePoints'] as const) if (own(args, key)) (link as unknown as Record<string, unknown>)[key] = args[key];
          if (args.resetRoute) delete link.routePoints;
          bind(action.key, link.id); data = { id: link.id }; break;
        }
        case 'delete_card_links': {
          const ids = (args.ids as string[]).map(resolve);
          if (ids.some((id) => !model.cardLinks.some((l) => l.id === id))) throw new Error('Одна из связей не найдена');
          model.cardLinks = model.cardLinks.filter((l) => !ids.includes(l.id)); break;
        }
        case 'link_section': {
          const nodeId = target('node', str(args, 'nodeId')), sectionId = target('section', str(args, 'sectionId'));
          if (!isLinkable(projectNodes(model.processes).find((n) => n.id === nodeId)!)) throw new Error('С пунктом связывается задача или шлюз BPMN');
          let link = model.links.find((l) => l.nodeId === nodeId && l.sectionId === sectionId);
          if (!link) { link = { id: uid('l'), nodeId, sectionId }; model.links.push(link); }
          model.meta[`section:${sectionId}`] = { ...model.meta[`section:${sectionId}`], coverage: 'Описывает шаги модели' };
          bind(action.key, link.id); data = { id: link.id }; break;
        }
        case 'unlink_section': {
          const id = resolve(str(args, 'id')); if (!model.links.some((l) => l.id === id)) throw new Error('Связь с пунктом не найдена');
          model.links = model.links.filter((l) => l.id !== id); break;
        }
        case 'edit_bpmn': {
          const raw = resolve(str(args, 'processId')), id = raw.startsWith('proc:') ? raw : `proc:${raw}`, pid = card(id).slice(5);
          const process = model.processes.find((p) => p.id === pid)!;
          unchanged(id);
          const local = (value: string) => { const resolved = resolve(value); if (resolved.startsWith(`${pid}:`)) return resolved.slice(pid.length + 1); if (resolved.includes(':') && !bpmn.symbols.some((s) => s.type === resolved)) throw new Error('Элемент относится к другой модели'); return resolved; };
          const added: Record<string, string> = {};
          for (const operation of args.operations as Record<string, unknown>[]) {
            const before = bpmn.read(process.xml); if (before.readOnlyReason) throw new Error(before.readOnlyReason);
            const op = str(operation, 'op'), element = typeof operation.id === 'string' ? local(operation.id) : '';
            const point = () => ({ x: number(operation, 'x'), y: number(operation, 'y') });
            const width = () => number(operation, 'width'), height = () => number(operation, 'height');
            switch (op) {
              case 'add_node': process.xml = bpmn.addNode(process.xml, str(operation, 'type'), point()); break;
              case 'add_region': process.xml = bpmn.addRegion!(process.xml, point()); break;
              case 'add_pool': process.xml = bpmn.addPool!(process.xml, point()); break;
              case 'rename': process.xml = bpmn.rename(process.xml, element, str(operation, 'name')); break;
              case 'move_node': process.xml = bpmn.moveNode(process.xml, element, point()); break;
              case 'resize_node': process.xml = bpmn.resizeNode!(process.xml, element, width(), height()); break;
              case 'move_region': process.xml = bpmn.moveRegion!(process.xml, element, point()); break;
              case 'resize_region': process.xml = bpmn.resizeRegion!(process.xml, element, width(), height()); break;
              case 'set_region_rows': process.xml = bpmn.setRegionRows!(process.xml, element, Math.round(number(operation, 'count'))); break;
              case 'connect': process.xml = bpmn.connect(process.xml, local(str(operation, 'from')), local(str(operation, 'to')), typeof operation.type === 'string' ? operation.type : undefined); break;
              case 'edit_edge': process.xml = bpmn.editEdge(process.xml, element, local(str(operation, 'from')), local(str(operation, 'to')), operation.points as { x: number; y: number }[]); break;
              case 'reset_edge': process.xml = bpmn.resetEdge(process.xml, element); break;
              case 'set_label_bounds': process.xml = bpmn.setLabelBounds!(process.xml, element, { ...point(), width: width(), height: height() }); break;
              case 'remove': process.xml = bpmn.remove(process.xml, element); break;
              default: throw new Error(`Неизвестная операция BPMN ${op}`);
            }
            if (operation.key !== undefined) {
              const after = bpmn.read(process.xml).diagram;
              const oldIds = new Set([...before.diagram.nodes, ...before.diagram.edges, ...(before.diagram.regions ?? [])].map((n) => n.id));
              const additions = [...after.nodes, ...after.edges, ...(after.regions ?? [])].filter((n) => !oldIds.has(n.id));
              const created = additions[additions.length - 1];
              if (!created) throw new Error('Операция не создала новый элемент для key');
              const ref = `${pid}:${created.id}`; bind(str(operation, 'key'), ref); added[str(operation, 'key')] = ref;
            }
          }
          cleanReferences(); touched(id); data = { id, elements: added }; break;
        }
        case 'create_issue': {
          if (action.key && aliases.has(action.key)) { data = { id: aliases.get(action.key), alreadyCreated: true }; summary = 'Замечание уже создано'; break; }
          const issue: Issue = { id: uid('manual-ai-'), title: titleOf(args), status: 'open', summary: '', question: '' };
          fillIssue(issue, args); issues.push(issue); bind(action.key, issue.id); effect({ issue }); data = { id: issue.id }; break;
        }
        case 'update_issue': {
          const issue = findIssue(str(args, 'id')); fillIssue(issue, args); effect({ issue }); data = { id: issue.id }; break;
        }
        case 'delete_issue': {
          const issue = findIssue(str(args, 'id'));
          if (issue.auto) { fillIssue(issue, { status: 'closed' }); effect({ issue, closeAuto: true }); }
          else { issues.splice(issues.indexOf(issue), 1); effect({ issue }); }
          data = { id: issue.id }; break;
        }
        case 'set_view': {
          if (args.focusId !== undefined) args.focusId = card(str(args, 'focusId'));
          if (args.selectedIds !== undefined) args.selectedIds = (args.selectedIds as string[]).map(card);
          effect(args); break;
        }
        case 'open_editor': {
          const id = card(str(args, 'id')); if (!/^(proc|doc|html):/.test(id)) throw new Error('Для этого объекта нет редактора кода/модели');
          effect({ id }); break;
        }
        case 'export_object': effect({ id: card(str(args, 'id')) }); break;
        case 'show_properties': {
          const id = target(str(args, 'targetType'), str(args, 'id'));
          if (args.targetType === 'card' && id.startsWith('gw:')) throw new Error('У шлюза доски редактируется подпись через update_object; отдельного окна свойств нет');
          effect({ ...args, id }); break;
        }
        case 'select_issue': effect({ id: findIssue(str(args, 'id')).id }); break;
        case 'history': {
          if (args.direction === 'undo' ? !env.canUndo : !env.canRedo) throw new Error('Нет изменения для отмены или повтора');
          effect(args); break;
        }
        case 'clear_canvas': model = structuredClone(emptyModel); break;
        default: throw new Error(`Инструмент ${action.tool} не реализован`);
      }
    } catch (error) { throw new Error(`Команда ${index + 1} (${action.tool}): ${error instanceof Error ? error.message : String(error)}. Изменения этого пакета не применены.`); }
    if (action.key && data && typeof data === 'object' && 'id' in data && typeof data.id === 'string') bind(action.key, data.id);
    observations.push({ action, result: { ok: true, summary, ...(data !== undefined ? { data } : {}) } });
  }
  const live = new Set(canvasCardIds(model));
  return { model, changed: JSON.stringify(model) !== JSON.stringify(input), observations, effects, aliases, refs: refs.filter((r) => live.has(`${r.kind}:${r.id}`)) };
}

function aiToolCatalogName(tool: string): string {
  const names: Record<string, string> = { read_canvas: 'Обзор доски прочитан', read_object: 'Содержимое объекта прочитано', set_layout: 'Положение и размер обновлены', set_properties: 'Свойства обновлены', connect_cards: 'Связь карточек создана', update_card_link: 'Связь карточек обновлена', delete_card_links: 'Связи карточек удалены', link_section: 'Шаг связан с пунктом документа', unlink_section: 'Связь с пунктом удалена', edit_bpmn: 'Схема BPMN обновлена', clear_canvas: 'Канвас очищен' };
  return names[tool] ?? tool;
}

export function exportCanvasObject(model: Model, id: string): { content: string; filename: string; mime: string } {
  const item = canvasObject(model, id); if (!item) throw new Error('Объект для экспорта не найден');
  const name = canvasTitle(item).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'object';
  if ('xml' in item) return { content: item.xml, filename: `${name}.bpmn`, mime: 'application/xml' };
  if ('html' in item) return { content: item.html, filename: `${name}.html`, mime: 'text/html' };
  if ('markdown' in item) return { content: item.markdown, filename: `${name}.md`, mime: 'text/markdown' };
  return { content: JSON.stringify(item, null, 2), filename: `${name}.json`, mime: 'application/json' };
}
