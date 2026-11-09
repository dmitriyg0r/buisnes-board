import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { HtmlObject } from './data';
import { HtmlPreview } from './HtmlPreview';
import { HtmlCodeEditor } from './HtmlCodeEditor';
import { Icon } from './Icon';

interface Props {
  object: HtmlObject;
  onChange: (title: string, html: string) => void;
  onCheckpoint: () => void;
  onClose: () => void;
}

const LAYOUT_KEY = 'bb.html-editor-layout.v1';
function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    return { split: typeof saved?.split === 'number' && Number.isFinite(saved.split) ? Math.max(0.2, Math.min(0.8, saved.split)) : 0.5, codeCollapsed: saved?.codeCollapsed === true, previewCollapsed: saved?.previewCollapsed === true && saved?.codeCollapsed !== true };
  } catch { return { split: 0.5, codeCollapsed: false, previewCollapsed: false }; }
}

export default function HtmlEditorDialog({ object, onChange, onCheckpoint, onClose }: Props) {
  const [name, setName] = useState(object.title);
  const [html, setHtml] = useState(object.html);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState(loadLayout);
  const [stacked, setStacked] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [resizing, setResizing] = useState(false);
  const panes = useRef<HTMLDivElement>(null);
  const resizePointer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  // Правки ИИ и отмена на доске могут прийти, пока редактор уже открыт.
  useEffect(() => { setName(object.title); }, [object.title]);
  useEffect(() => { setHtml(object.html); }, [object.html]);

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* хранилище недоступно */ }
  }, [layout]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setStacked(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const togglePane = (pane: 'code' | 'preview') => setLayout((old) => {
    if (pane === 'code') return { ...old, codeCollapsed: !old.codeCollapsed, previewCollapsed: old.codeCollapsed ? old.previewCollapsed : false };
    return { ...old, previewCollapsed: !old.previewCollapsed, codeCollapsed: old.previewCollapsed ? old.codeCollapsed : false };
  });
  const resizeTo = (split: number) => setLayout((old) => ({ ...old, split: Math.max(0.2, Math.min(0.8, split)) }));
  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizePointer.current !== event.pointerId) return;
    resizePointer.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const update = (code: string) => {
    setHtml(code);
    onChange(nameRef.current.trim() || 'HTML-объект', code);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError('Файл слишком большой: до 2 МБ.'); return; }
    try {
      const code = await file.text();
      onCheckpoint();
      update(code);
      setError(null);
    } catch { setError('Не удалось прочитать HTML-файл. Попробуйте ещё раз.'); }
  };
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.trim() || 'object'}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <div className="html-editor" role="dialog" aria-modal="true" aria-label="Редактор HTML-объекта" onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyS') event.preventDefault();
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <header className="bpmn-head">
      <span className="dlg-icon"><Icon name="code" size={18} /></span>
      <input className="bpmn-title" aria-label="Название HTML-объекта" value={name} onFocus={onCheckpoint} onChange={(event) => {
        setName(event.target.value);
        onChange(event.target.value.trim() || 'HTML-объект', html);
      }} />
      <div className="grow" />
      {error && <span className="bpmn-error" role="alert">{error}</span>}
      <input ref={fileInput} type="file" accept=".html,.htm,text/html" hidden onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ''; }} />
      <button type="button" className="icon-btn" title="Импорт .html" aria-label="Импорт .html" onClick={() => fileInput.current?.click()}><Icon name="upload" size={18} /></button>
      <button type="button" className="icon-btn" title="Экспорт .html" aria-label="Экспорт .html" onClick={exportFile}><Icon name="download" size={18} /></button>
      <button type="button" className="icon-btn" title="Закрыть" aria-label="Закрыть" onClick={onClose}><Icon name="close" size={18} /></button>
    </header>
    <div ref={panes} className={`html-editor-panes${layout.codeCollapsed ? ' code-collapsed' : ''}${layout.previewCollapsed ? ' preview-collapsed' : ''}${resizing ? ' resizing' : ''}`} style={{ '--html-code-size': `${layout.split}fr`, '--html-preview-size': `${1 - layout.split}fr` } as CSSProperties}>
      <section className="html-source-pane" aria-label="Код HTML">
        <button type="button" className="html-pane-rail" hidden={!layout.codeCollapsed} title="Развернуть код" aria-label="Развернуть код" aria-expanded={false} onClick={() => togglePane('code')}><Icon name={stacked ? 'chevronDown' : 'chevronRight'} /><span>Код</span></button>
        <div className="html-pane-expanded" hidden={layout.codeCollapsed}>
          <div className="html-pane-head"><b>Код</b><div className="grow" /><span>HTML · CSS · JavaScript</span><button type="button" className="icon-btn" title="Свернуть код" aria-label="Свернуть код" aria-expanded onClick={() => togglePane('code')}><Icon name={stacked ? 'chevronUp' : 'chevronLeft'} /></button></div>
          <HtmlCodeEditor value={html} onFocus={onCheckpoint} onChange={update} />
        </div>
      </section>
      <div className="html-pane-divider" role="separator" aria-label="Размер панелей кода и предпросмотра" aria-orientation={stacked ? 'horizontal' : 'vertical'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(layout.split * 100)} aria-valuetext={`Код ${Math.round(layout.split * 100)}%, предпросмотр ${Math.round((1 - layout.split) * 100)}%`} aria-hidden={layout.codeCollapsed || layout.previewCollapsed || undefined} tabIndex={layout.codeCollapsed || layout.previewCollapsed ? -1 : 0} title="Перетащите для изменения размера; двойной щелчок — поровну" onDoubleClick={() => resizeTo(0.5)} onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        resizePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizing(true);
      }} onPointerMove={(event) => {
        if (resizePointer.current !== event.pointerId || !panes.current) return;
        const rect = panes.current.getBoundingClientRect();
        resizeTo(stacked ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width);
      }} onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize} onKeyDown={(event) => {
        const direction = stacked ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
        if (event.key === 'Home') resizeTo(0.2);
        else if (event.key === 'End') resizeTo(0.8);
        else if (direction.includes(event.key)) resizeTo(layout.split + (event.key === direction[0] ? -0.05 : 0.05));
        else return;
        event.preventDefault();
      }} />
      <section className="html-preview-pane" aria-label="Предпросмотр HTML">
        <button type="button" className="html-pane-rail" hidden={!layout.previewCollapsed} title="Развернуть предпросмотр" aria-label="Развернуть предпросмотр" aria-expanded={false} onClick={() => togglePane('preview')}><Icon name={stacked ? 'chevronUp' : 'chevronLeft'} /><span>Предпросмотр</span></button>
        <div className="html-pane-expanded" hidden={layout.previewCollapsed}>
          <div className="html-pane-head"><b>Предпросмотр</b><div className="grow" /><button type="button" className="icon-btn" title="Перезапустить предпросмотр" aria-label="Перезапустить предпросмотр" onClick={() => setRevision((v) => v + 1)}><Icon name="redo" /></button><button type="button" className="icon-btn" title="Свернуть предпросмотр" aria-label="Свернуть предпросмотр" aria-expanded onClick={() => togglePane('preview')}><Icon name={stacked ? 'chevronDown' : 'chevronRight'} /></button></div>
          <HtmlPreview key={revision} html={html} title={name} />
        </div>
      </section>
    </div>
  </div>;
}
