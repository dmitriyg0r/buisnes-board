import { useState } from 'react';
import type { Doc, Process, Source } from './data';
import { Icon } from './Icon';
import { objectCatalog } from './objectCatalog';

interface Props {
  activeSourceId?: string;
  sources: Source[];
  docs: Doc[];
  processes: Process[];
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

export function Tree({ activeSourceId, sources, docs, processes, onAddMaterial, collapsed, onToggle }: Props) {
  const [open, setOpen] = useState({ src: true, mod: true, proc: true, doc: true });
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
          <div key={s.id} className="tree-row">
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
            <div key={p.id} className="tree-row linked">
              <Icon name="model" />
              <span>{p.title}</span>
            </div>
          ))}
        </Group>
      </Group>

      <Group title="Документы" open={open.doc} onToggle={() => toggle('doc')}>
        {docs.length === 0 && <div className="tree-empty">Нет документов</div>}
        {docs.map((d) => (
          <div key={d.id} className="tree-row linked">
            <Icon name="file" />
            <span className="doc-name">
              <span>{d.title}</span>
            </span>
          </div>
        ))}
      </Group>

      <div className="grow" />
      <button type="button" className="add-material" onClick={onAddMaterial}>
        <Icon name="plus" size={15} stroke={2.2} />
        Добавить объект
      </button>
    </aside>
  );
}
