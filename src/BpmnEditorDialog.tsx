import { useEffect, useRef, useState } from 'react';
import Modeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import { Icon } from './Icon';
import { russianModule } from './bpmnRu';

interface Props {
  title: string;
  xml: string;
  onSave: (title: string, xml: string) => void;
  onClose: () => void;
}

/** Полноэкранный редактор BPMN на базе bpmn-js: палитра слева, контекстная панель у элементов. */
export default function BpmnEditorDialog({ title, xml, onSave, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const modeler = useRef<Modeler | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(title);
  const [dirty, setDirty] = useState(name !== title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const m = new Modeler({ container: box.current, keyboard: { bindTo: window }, additionalModules: [russianModule] });
    modeler.current = m;
    let dead = false;
    m.importXML(xml)
      .then(() => {
        if (dead) return;
        (m.get('canvas') as any).zoom('fit-viewport', 'auto');
        setDirty(false);
        m.on('commandStack.changed', () => setDirty(true));
      })
      .catch(() => !dead && setError('Не удалось открыть модель: файл повреждён.'));
    return () => {
      dead = true;
      m.destroy();
      modeler.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!modeler.current) return;
    setBusy(true);
    setError(null);
    try {
      const { xml: out } = await modeler.current.saveXML({ format: true });
      onSave(name.trim() || 'Модель процесса', out ?? '');
    } catch {
      setError('Не удалось сохранить модель: в диаграмме есть ошибки.');
      setBusy(false);
    }
  };

  const exportFile = async () => {
    if (!modeler.current) return;
    try {
      const { xml: out } = await modeler.current.saveXML({ format: true });
      const url = URL.createObjectURL(new Blob([out ?? ''], { type: 'application/xml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.trim() || 'process'}.bpmn`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Не удалось выгрузить модель.');
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file || !modeler.current) return;
    setError(null);
    try {
      await modeler.current.importXML(await file.text());
      (modeler.current.get('canvas') as any).zoom('fit-viewport', 'auto');
      setDirty(true);
    } catch {
      setError('Не удалось загрузить файл: это не BPMN 2.0.');
    }
  };

  const close = () => {
    if (dirty && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  return (
    <div className="bpmn-editor" role="dialog" aria-modal="true" aria-label="Редактор BPMN">
      <header className="bpmn-head">
        <span className="dlg-icon"><Icon name="model" size={18} /></span>
        <input
          className="bpmn-title"
          value={name}
          aria-label="Название модели"
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
        />
        <div className="grow" />
        {error && <span className="bpmn-error" role="alert">{error}</span>}
        <input ref={fileInput} type="file" accept=".bpmn,.xml,application/xml,text/xml" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Импорт</button>
        <button type="button" className="btn" onClick={() => void exportFile()}>Экспорт</button>
        {confirmClose ? (
          <>
            <span className="bpmn-warn">Есть несохранённые изменения</span>
            <button type="button" className="btn btn-danger" onClick={onClose}>Закрыть без сохранения</button>
            <button type="button" className="btn" onClick={() => setConfirmClose(false)}>Продолжить правку</button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={close}>Закрыть</button>
            <button type="button" className="btn btn-dark" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </>
        )}
      </header>
      <div className="bpmn-canvas" ref={box} />
    </div>
  );
}
