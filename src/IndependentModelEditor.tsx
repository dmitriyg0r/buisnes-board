import { useRef, useState } from 'react';
import type { IndependentModel } from './data';
import { DiagramEditor } from './modeling/DiagramEditor';
import { getModelNotation } from './modeling/registry';
import { WorkspaceActionDialog } from './WorkspaceActionDialog';

export default function IndependentModelEditor({ model, onSave, onClose }: { model: IndependentModel; onSave: (title: string, source: string) => void; onClose: () => void }) {
  const initial = useRef(model);
  const [conflict, setConflict] = useState(false);
  const notation = getModelNotation(model.notation);
  if (!notation) return <WorkspaceActionDialog title="Неизвестная нотация" description={`Нотация «${model.notation}» не поддерживается этой версией. Данные сохранены без изменений.`} confirmLabel="Закрыть" busy={false} error={null} onClose={onClose} onConfirm={async () => { onClose(); return true; }} />;
  return <>
    <DiagramEditor notation={notation} title={model.title} source={model.source} onClose={onClose} onSave={(title, source) => {
      if (initial.current.title !== model.title || initial.current.source !== model.source || initial.current.notation !== model.notation) { setConflict(true); return; }
      onSave(title, source);
    }} />
    {conflict && <WorkspaceActionDialog title="Модель изменилась" description="Модель была изменена другим участником. Сохранение остановлено; экспортируйте свою версию и откройте модель заново." confirmLabel="Понятно" busy={false} error={null} onClose={() => setConflict(false)} onConfirm={async () => { setConflict(false); return true; }} />}
  </>;
}
