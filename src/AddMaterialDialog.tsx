import { useEffect, useState } from 'react';
import type { Source } from './data';
import { Icon } from './Icon';

interface Props {
  /** сколько уже добавлено: нужно для названий по умолчанию */
  counts: { processes: number; docs: number };
  onAddModel: (title: string) => void;
  onAddDoc: (title: string) => void;
  onAddSource: (s: Omit<Source, 'id'>) => void;
  onClose: () => void;
}

export function AddMaterialDialog({ counts, onAddModel, onAddDoc, onAddSource, onClose }: Props) {
  const [kind, setKind] = useState<'model' | 'doc' | 'source'>(counts.processes === 0 ? 'model' : counts.docs === 0 ? 'doc' : 'source');
  const [modelName, setModelName] = useState(counts.processes ? `Модель процесса ${counts.processes + 1}` : 'Модель процесса');
  const [title, setTitle] = useState(counts.docs ? `Документ ${counts.docs + 1}` : 'Регламент');
  const [name, setName] = useState('');
  const [ext, setExt] = useState<Source['ext']>('DOCX');
  const [pages, setPages] = useState(1);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const valid = kind === 'model' ? modelName.trim().length > 0 : kind === 'doc' ? title.trim().length > 0 : name.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (kind === 'model') onAddModel(modelName.trim());
    else if (kind === 'doc') onAddDoc(title.trim());
    else onAddSource({ name: name.trim(), ext, pages: Math.max(1, Math.round(pages) || 1) });
    onClose();
  };

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dlg" role="dialog" aria-modal="true" aria-label="Добавить материал" onSubmit={submit}>
        <div className="dlg-head">
          <span className="dlg-icon"><Icon name="plus" size={18} /></span>
          <div className="dlg-title">
            <b>Добавить материал</b>
            <small>Материал появится на полотне и в дереве проекта</small>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="dlg-body">
          <fieldset className="kinds">
            <legend className="plabel">Что добавляем</legend>
            <label className={`kind${kind === 'model' ? ' on' : ''}`}>
              <input type="radio" name="kind" checked={kind === 'model'} onChange={() => setKind('model')} />
              <b>Модель процесса (BPMN)</b>
              <small>Дорожки, шаги и переходы процесса. Моделей может быть несколько</small>
            </label>
            <label className={`kind${kind === 'doc' ? ' on' : ''}`}>
              <input type="radio" name="kind" checked={kind === 'doc'} onChange={() => setKind('doc')} />
              <b>Документ (Markdown)</b>
              <small>Текст, который можно править. Заголовки становятся пунктами, их связывают с шагами модели</small>
            </label>
            <label className={`kind${kind === 'source' ? ' on' : ''}`}>
              <input type="radio" name="kind" checked={kind === 'source'} onChange={() => setKind('source')} />
              <b>Источник</b>
              <small>Соглашение, интервью или другой материал, на который опираются замечания</small>
            </label>
          </fieldset>

          {kind === 'model' ? (
            <label className="prow">
              <span className="plabel">Название модели</span>
              <input className="pinput" value={modelName} onChange={(e) => setModelName(e.target.value)} autoFocus />
            </label>
          ) : kind === 'doc' ? (
            <label className="prow">
              <span className="plabel">Название документа</span>
              <input className="pinput" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
          ) : (
            <>
              <label className="prow">
                <span className="plabel">Название файла</span>
                <input className="pinput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название файла" autoFocus />
              </label>
              <label className="prow">
                <span className="plabel">Формат</span>
                <select className="pinput" value={ext} onChange={(e) => setExt(e.target.value as Source['ext'])}>
                  <option>DOCX</option>
                  <option>PDF</option>
                </select>
              </label>
              <label className="prow">
                <span className="plabel">Страниц</span>
                <input className="pinput" type="number" min={1} value={pages} onChange={(e) => setPages(Number(e.target.value))} />
              </label>
              <p className="pnote">Сам файл пока не загружается: сохраняются название и формат.</p>
            </>
          )}
        </div>

        <div className="dlg-foot">
          <span />
          <div className="pactions">
            <button type="button" className="btn" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-dark" disabled={!valid}>Добавить</button>
          </div>
        </div>
      </form>
    </div>
  );
}
