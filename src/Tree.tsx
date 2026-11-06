import { useState } from 'react';
import type { Doc, Issue, Process, Source } from './data';
import type { Coverage } from './coverage';
import { Icon } from './Icon';

interface Props {
  issues: Issue[];
  selectedId: string;
  onSelect: (id: string) => void;
  activeSourceId?: string;
  cover: Coverage;
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
        <span>{title}</span>
      </button>
      {open && <div className="tree-children">{children}</div>}
    </div>
  );
}

export function Tree({ issues, selectedId, onSelect, activeSourceId, cover, sources, docs, processes, onAddMaterial, collapsed, onToggle }: Props) {
  const [open, setOpen] = useState({ src: true, mod: true, doc: true, iss: true });
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
        {processes.length === 0 && <div className="tree-empty">Нет моделей</div>}
        {processes.map((p) => (
          <div key={p.id} className="tree-row linked">
            <Icon name="model" />
            <span>{p.title}</span>
          </div>
        ))}
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

      <Group title="Замечания" open={open.iss} onToggle={() => toggle('iss')}>
        <div className="tree-row amber-label">
          <Icon name="flag" />
          <span>Открытые · {issues.filter((i) => i.status !== 'fixed' && i.status !== 'closed').length}</span>
        </div>
        <div className="tree-issues">
          {issues.map((i, n) => (
            <button
              key={i.id}
              type="button"
              className={`tree-issue${i.id === selectedId ? ' on' : ''}${i.status === 'fixed' || i.status === 'closed' ? ' done' : ''}`}
              onClick={() => onSelect(i.id)}
            >
              <span className="num">{n + 1}</span>
              <span>{i.title}</span>
              {i.auto && <em className="auto-tag">авто</em>}
            </button>
          ))}
        </div>
      </Group>

      <div className="grow" />
      <div className="cover">
        <div className="label">Согласованность</div>
        <CoverRow label="Шаги с пунктом" v={cover.steps} />
        <CoverRow label="Пункты с шагом" v={cover.sections} />
      </div>
      <button type="button" className="add-material" onClick={onAddMaterial}>
        <Icon name="plus" size={15} stroke={2.2} />
        Добавить материал
      </button>
    </aside>
  );
}

function CoverRow({ label, v }: { label: string; v: { total: number; linked: number } }) {
  const full = v.linked === v.total;
  return (
    <div className="cover-row">
      <span>{label}</span>
      <b className={full ? 'ok' : 'warn'}>{v.linked} из {v.total}</b>
      <i className="bar"><i style={{ width: `${v.total ? (v.linked / v.total) * 100 : 0}%` }} className={full ? 'ok' : 'warn'} /></i>
    </div>
  );
}
