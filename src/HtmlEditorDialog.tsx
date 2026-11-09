import { useRef, useState } from 'react';
import type { HtmlObject } from './data';
import { HtmlPreview } from './HtmlPreview';
import { Icon } from './Icon';

interface Props {
  object: HtmlObject;
  onChange: (title: string, html: string) => void;
  onCheckpoint: () => void;
  onClose: () => void;
}

export default function HtmlEditorDialog({ object, onChange, onCheckpoint, onClose }: Props) {
  const [name, setName] = useState(object.title);
  const [html, setHtml] = useState(object.html);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

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
    <div className="html-editor-panes">
      <section className="html-source-pane" aria-label="Код HTML">
        <div className="html-pane-head"><b>Код</b><span>HTML · CSS · JavaScript</span></div>
        <textarea className="html-code" aria-label="HTML-код" value={html} autoFocus spellCheck={false} autoCapitalize="off" autoCorrect="off" onFocus={onCheckpoint} onChange={(event) => update(event.target.value)} onKeyDown={(event) => {
          if (event.key !== 'Tab' || event.shiftKey) return;
          event.preventDefault();
          const input = event.currentTarget;
          const start = input.selectionStart, end = input.selectionEnd;
          update(html.slice(0, start) + '  ' + html.slice(end));
          requestAnimationFrame(() => input.setSelectionRange(start + 2, start + 2));
        }} />
      </section>
      <section className="html-preview-pane" aria-label="Предпросмотр HTML">
        <div className="html-pane-head"><b>Предпросмотр</b><button type="button" className="icon-btn" title="Перезапустить предпросмотр" aria-label="Перезапустить предпросмотр" onClick={() => setRevision((v) => v + 1)}><Icon name="redo" /></button></div>
        <HtmlPreview key={revision} html={html} title={name} />
      </section>
    </div>
    <footer className="html-editor-foot"><span>Изменения сохраняются автоматически</span><span>Встроенные стили и скрипты; внешние ресурсы не загружаются</span></footer>
  </div>;
}
