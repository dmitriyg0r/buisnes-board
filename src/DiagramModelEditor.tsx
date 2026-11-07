import { useRef, useState } from 'react';
import { parseProcess } from './bpmn';
import { DiagramEditor } from './modeling/DiagramEditor';
import { bpmnCollaborationFacade } from './modeling/bpmnCollaborationFacade';
import { WorkspaceActionDialog } from './WorkspaceActionDialog';

interface Props {
  title: string;
  xml: string;
  processId: string;
  links: { id: string; nodeId: string }[];
  onSave: (title: string, xml: string, removeLinkIds: string[]) => void;
  onClose: () => void;
}

/** BPMN — первая нотация, подключённая к общему редактору диаграмм. */
export default function DiagramModelEditor({ title, xml, processId, links, onSave, onClose }: Props) {
  const initial = useRef({ title, xml });
  const [pending, setPending] = useState<{ title: string; xml: string; linkIds: string[]; imported: boolean } | null>(null);
  const [conflict, setConflict] = useState(false);
  const changedElsewhere = () => initial.current.xml !== xml || initial.current.title !== title;
  const affectedLinks = (nextXml: string, imported: boolean) => {
    const before = new Set(parseProcess(initial.current.xml).nodes.map((node) => `${processId}:${node.id}`));
    const after = new Set(parseProcess(nextXml).nodes.map((node) => `${processId}:${node.id}`));
    return links.filter((link) => imported ? link.nodeId.startsWith(`${processId}:`) : before.has(link.nodeId) && !after.has(link.nodeId)).map((link) => link.id).sort();
  };
  const save = (nextTitle: string, nextXml: string, imported: boolean) => {
    if (changedElsewhere()) { setConflict(true); return; }
    const linkIds = affectedLinks(nextXml, imported);
    if (linkIds.length) setPending({ title: nextTitle, xml: nextXml, linkIds, imported });
    else onSave(nextTitle, nextXml, []);
  };
  return <>
    <DiagramEditor notation={bpmnCollaborationFacade} title={title} source={xml} onSave={save} onClose={onClose} />
    {pending && <WorkspaceActionDialog title="Удалить связанные привязки?" description={`${pending.imported ? 'Импорт заменит модель: совпадение ID не гарантирует совпадение элементов.' : 'Из модели исчезнут элементы, связанные с пунктами документов.'} При сохранении будут удалены привязки: ${pending.linkIds.length}. Отмените сохранение, если хотите сначала проверить изменения.`} confirmLabel="Сохранить и удалить привязки" danger busy={false} error={null} onClose={() => setPending(null)} onConfirm={async () => {
      if (changedElsewhere()) { setPending(null); setConflict(true); return false; }
      const linkIds = affectedLinks(pending.xml, pending.imported);
      if (JSON.stringify(linkIds) !== JSON.stringify(pending.linkIds)) { setPending({ ...pending, linkIds }); return false; }
      onSave(pending.title, pending.xml, pending.linkIds); return true;
    }} />}
    {conflict && <WorkspaceActionDialog title="Модель изменилась" description="Пока редактор был открыт, модель изменилась вне него. Сохранение остановлено, чтобы не перезаписать изменения. Экспортируйте свою версию, затем закройте и откройте модель заново." confirmLabel="Понятно" busy={false} error={null} onClose={() => setConflict(false)} onConfirm={async () => true} />}
  </>;
}
