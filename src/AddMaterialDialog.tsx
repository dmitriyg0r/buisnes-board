import { useEffect, useRef, useState } from 'react';
import type { Source } from './data';
import { Icon } from './Icon';
import { objectCatalog, type ObjectCategoryId, type ObjectTypeId } from './objectCatalog';

interface Props {
  counts: { processes: number; docs: number };
  onAddModel: (title: string) => void;
  onAddDoc: (title: string) => void;
  onAddSource: (s: Omit<Source, 'id'>) => void;
  onClose: () => void;
}

export function AddMaterialDialog({ counts, onAddModel, onAddDoc, onAddSource, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [categoryId, setCategoryId] = useState<ObjectCategoryId>('processes');
  const [typeId, setTypeId] = useState<ObjectTypeId>(objectCatalog[0].types[0].id);
  const [modelName, setModelName] = useState(counts.processes ? `Модель процесса ${counts.processes + 1}` : 'Модель процесса');
  const [title, setTitle] = useState(counts.docs ? `Документ ${counts.docs + 1}` : 'Регламент');
  const [name, setName] = useState('');
  const [ext, setExt] = useState<Source['ext']>('DOCX');
  const [pages, setPages] = useState(1);
  const category = objectCatalog.find((item) => item.id === categoryId)!;
  const type = category.types.find((item) => item.id === typeId) ?? category.types[0];
  const value = type.kind === 'process' ? modelName : type.kind === 'document' ? title : name;
  const valid = value.trim().length > 0;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>('[data-category-active]')?.focus();
    return () => { if (element?.open) element.close(); };
  }, []);

  const chooseCategory = (id: ObjectCategoryId) => {
    const next = objectCatalog.find((item) => item.id === id)!;
    setCategoryId(id);
    setTypeId(next.types[0].id);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    switch (type.id) {
      case 'bpmn': onAddModel(modelName.trim()); break;
      case 'markdown': onAddDoc(title.trim()); break;
      case 'source-reference': onAddSource({ name: name.trim(), ext, pages: Math.max(1, Math.round(pages) || 1) }); break;
      default: { const unsupported: never = type.id; return unsupported; }
    }
    onClose();
  };

  return (
    <dialog ref={dialog} className="dlg create-object-dialog" aria-labelledby="create-object-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit}>
        <div className="dlg-head">
          <span className="dlg-icon"><Icon name="plus" size={18} /></span>
          <div className="dlg-title">
            <b id="create-object-title">Добавить объект</b>
            <small>Выберите категорию и тип объекта</small>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="create-object-content">
          <nav className="create-object-categories" aria-label="Категории объектов">
            <span className="create-object-label">Категории</span>
            {objectCatalog.map((item) => <button key={item.id} type="button" className={`create-object-category${categoryId === item.id ? ' on' : ''}`} aria-pressed={categoryId === item.id} data-category-active={categoryId === item.id || undefined} onClick={() => chooseCategory(item.id)}>
              <Icon name="folder" size={17} /><span>{item.title}</span><Icon name="chevronRight" size={14} />
            </button>)}
          </nav>
          <div className="create-object-main">
            <div className="create-object-heading"><h2>{category.title}</h2><p>{category.description}</p></div>
            <fieldset className="create-object-types">
              <legend className="create-object-label">Тип объекта</legend>
              {category.types.map((item) => <label key={item.id} className={`create-object-type${type.id === item.id ? ' on' : ''}`}>
                <input type="radio" name="object-type" checked={type.id === item.id} onChange={() => setTypeId(item.id)} />
                <span className="create-object-type-icon"><Icon name={item.icon} size={19} /></span>
                <span className="create-object-type-copy"><b>{item.title}</b><small>{item.description}</small></span>
                <span className="create-object-format">{item.format}</span>
              </label>)}
            </fieldset>
            <div className="create-object-fields">
              <label className="create-object-field"><span>{type.kind === 'process' ? 'Название модели' : type.kind === 'document' ? 'Название документа' : 'Название источника'}</span>
                <input className="pinput" value={value} onChange={(event) => type.kind === 'process' ? setModelName(event.target.value) : type.kind === 'document' ? setTitle(event.target.value) : setName(event.target.value)} placeholder={type.kind === 'source' ? 'Название файла' : undefined} required />
              </label>
              {type.kind === 'source' && <>
                <div className="create-object-source-fields">
                  <label className="create-object-field"><span>Формат</span><select className="pinput" value={ext} onChange={(event) => setExt(event.target.value as Source['ext'])}><option>DOCX</option><option>PDF</option></select></label>
                  <label className="create-object-field"><span>Страниц</span><input className="pinput" type="number" min={1} value={pages} onChange={(event) => setPages(Number(event.target.value))} /></label>
                </div>
                <p className="pnote">Сам файл пока не загружается: сохраняются название, формат и количество страниц.</p>
              </>}
            </div>
          </div>
        </div>
        <div className="dlg-foot"><span>Объект появится на полотне и в структуре проекта</span><div className="pactions"><button type="button" className="btn" onClick={onClose}>Отмена</button><button type="submit" className="btn btn-dark" disabled={!valid}>Добавить</button></div></div>
      </form>
    </dialog>
  );
}
