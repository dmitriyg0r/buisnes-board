import { useState } from 'react';
import type { Doc, HtmlObject, IndependentModel, Process, Source } from './data';
import { Icon } from './Icon';
import { objectCatalog } from './objectCatalog';
import { modelDefinitions } from './modeling/registry';

interface Props {
  activeSourceId?: string;
  sources: Source[];
  docs: Doc[];
  processes: Process[];
  models: IndependentModel[];
  onEditModel: (id: string) => void;
  onDeleteModel: (id: string) => void;
  htmlObjects: HtmlObject[];
  onEditHtml: (id: string) => void;
  /** карточки, выделенные на полотне: их строки подсвечиваются */
  selectedCards: string[];
  onAddMaterial: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

function Group({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="tree-group">
      <button type="button" className="tree-head" onClick={onToggle} aria-expanded={open}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} stroke={2.2} />
        <Icon name="folder" size={16} />
        <span>{title}</span>
      </button>
      {open && <div className="tree-children">{children}</div>}
    </div>
  );
}

export function Tree({ activeSourceId, sources, docs, processes, models, onEditModel, onDeleteModel, htmlObjects, onEditHtml, selectedCards, onAddMaterial, collapsed, onToggle }: Props) {
  const isSel = (id: string) => selectedCards.includes(id);
  const [open, setOpen] = useState({ src: true, mod: true, proc: true, doc: true, html: true });
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (collapsed) {
    return (
      <aside className="tree rail">
        <button type="button" className="icon-btn" aria-label="Развернуть структуру проекта" title="Развернуть структуру проекта" aria-expanded={false} onClick={onToggle}>
          <Icon name="chevronRight" />
        </button>
        <span className="rail-label">Структура проекта</span>
      </aside>
    );
  }

  return (
    <aside className="tree">
      <div className="tree-title">
        <span>Структура проекта</span>
        <button type="button" className="icon-btn" aria-label="Свернуть структуру проекта" title="Свернуть" aria-expanded onClick={onToggle}>
          <Icon name="chevronLeft" />
        </button>
      </div>

      <Group title="Источники" open={open.src} onToggle={() => toggle('src')}>
        {sources.length === 0 && <div className="tree-empty">Нет источников</div>}
        {sources.map((s) => (
          <div key={s.id} className={`tree-row${isSel(`src:${s.id}`) ? ' sel' : ''}`}>
            <span className={`ext ext-${s.ext.toLowerCase()}`}>{s.ext === 'PDF' ? 'PDF' : 'DOC'}</span>
            <span className="grow">{s.name}</span>
            {s.id === activeSourceId && <span className="dot-amber" title="Основание выбранного замечания" />}
          </div>
        ))}
      </Group>

      <Group title="Модели" open={open.mod} onToggle={() => toggle('mod')}>
        <Group title={objectCatalog.find((item) => item.id === 'processes')!.title} open={open.proc} onToggle={() => toggle('proc')}>
          {processes.length === 0 && <div className="tree-empty">Нет моделей</div>}
          {processes.map((p) => (
            <div key={p.id} className={`tree-row${isSel(`proc:${p.id}`) ? ' sel' : ''}`}>
              <Icon name="model" />
              <span>{p.title}</span>
            </div>
          ))}
        </Group>
        {['uml', 'epc', 'other'].map((group) => {
          const entries = models.filter((m) => group === 'uml' ? m.notation.startsWith('uml-') : group === 'epc' ? m.notation === 'epc' : !m.notation.startsWith('uml-') && m.notation !== 'epc');
          if (!entries.length) return null;
          return <div className="tree-group" key={group}><div className="tree-head">{group === 'uml' ? 'UML' : group === 'epc' ? 'EPC' : 'Другие нотации'}</div><div className="tree-children">{entries.map((m) => <div key={m.id} className={`tree-row${isSel(`model:${m.id}`) ? ' sel' : ''}`}><button type="button" onClick={() => onEditModel(m.id)} aria-label={`Открыть модель: ${m.title}`} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}><Icon name="model" /><span>{m.title}</span><small>{modelDefinitions.find((d) => d.id === m.notation)?.format ?? m.notation}</small></button><button type="button" className="icon-btn" aria-label={`Удалить модель: ${m.title}`} onClick={() => { if (window.confirm(`Удалить модель «${m.title}»?`)) onDeleteModel(m.id); }}><Icon name="trash" size={14} /></button></div>)}</div></div>;
        })}
      </Group>

      <Group title="Документы" open={open.doc} onToggle={() => toggle('doc')}>
        {docs.length === 0 && <div className="tree-empty">Нет документов</div>}
        {docs.map((d) => (
          <div key={d.id} className={`tree-row${isSel(`doc:${d.id}`) ? ' sel' : ''}`}>
            <Icon name="file" />
            <span className="doc-name">
              <span>{d.title}</span>
            </span>
          </div>
        ))}
      </Group>

      <Group title="HTML-объекты" open={open.html} onToggle={() => toggle('html')}>
        {htmlObjects.length === 0 && <div className="tree-empty">Нет HTML-объектов</div>}
        {htmlObjects.map((h) => <div key={h.id} className={`tree-row${isSel(`html:${h.id}`) ? ' sel' : ''}`} role="button" tabIndex={0} aria-label={`Редактировать HTML: ${h.title}`} onDoubleClick={() => onEditHtml(h.id)} onKeyDown={(event) => { if (event.key === 'Enter') onEditHtml(h.id); }}>
          <Icon name="code" /><span>{h.title}</span>
        </div>)}
      </Group>

      <div className="grow" />
      <button type="button" className="add-material" onClick={onAddMaterial}>
        <Icon name="plus" size={15} stroke={2.2} />
        Добавить объект
      </button>
    </aside>
  );
}
