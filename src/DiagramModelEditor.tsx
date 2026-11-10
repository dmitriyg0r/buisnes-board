import { useRef, useState } from 'react';
import { parseProcess } from './bpmn';
import { DiagramEditor } from './modeling/DiagramEditor';
import { bpmnCollaborationFacade } from './modeling/bpmnCollaborationFacade';
import { WorkspaceActionDialog } from './WorkspaceActionDialog';
import type { Presence } from './presence';
import type { SyncState } from './sync';
import type { DocLink } from './data';

interface Props {
  title: string;
  xml: string;
  processId: string;
  links: { id: string; nodeId: string; sectionId?: string }[];
  onSave: (title: string, xml: string, removeLinkIds: string[]) => void;
  onClose: () => void;
  onChange?: (title: string, xml: string, removeLinkIds: string[], restoreLinks?: DocLink[]) => boolean;
  presence?: Presence;
  saveState?: SyncState;
}

/** BPMN — первая нотация, подключённая к общему редактору диаграмм. */
export default function DiagramModelEditor({ title, xml, processId, links, onSave, onClose, onChange, presence, saveState = 'saved' }: Props) {
  const initial = useRef({ title, xml });
  const [pending, setPending] = useState<{ title: string; xml: string; linkIds: string[]; imported: boolean; baseXml: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const removedLinks = useRef(new Map<string, DocLink>());
  const commit = (nextTitle: string, nextXml: string, removeIds: string[], imported: boolean) => {
    if (!onChange) return false;
    const nodes = new Set(parseProcess(nextXml).nodes.map(node => `${processId}:${node.id}`));
    const restore = imported ? [] : [...removedLinks.current.values()].filter(link => nodes.has(link.nodeId) && !links.some(current => current.id === link.id));
    const removed = links.filter((link): link is DocLink => removeIds.includes(link.id) && typeof link.sectionId === 'string');
    const accepted = onChange(nextTitle, nextXml, removeIds, restore);
    if (accepted) {
      if (!imported) for (const link of removed) removedLinks.current.set(link.id, link);
      for (const link of restore) removedLinks.current.delete(link.id);
    }
    return accepted;
  };
  const changedElsewhere = () => initial.current.xml !== xml || initial.current.title !== title;
  const affectedLinks = (nextXml: string, imported: boolean) => {
    const before = new Set(parseProcess(onChange ? xml : initial.current.xml).nodes.map((node) => `${processId}:${node.id}`));
    const after = new Set(parseProcess(nextXml).nodes.map((node) => `${processId}:${node.id}`));
    return links.filter((link) => imported ? link.nodeId.startsWith(`${processId}:`) : before.has(link.nodeId) && !after.has(link.nodeId)).map((link) => link.id).sort();
  };
  const save = (nextTitle: string, nextXml: string, imported: boolean) => {
    if (!onChange && changedElsewhere()) { setConflict(true); return false; }
    const linkIds = affectedLinks(nextXml, imported);
    if (linkIds.length) { setPending({ title: nextTitle, xml: nextXml, linkIds, imported, baseXml: xml }); return false; }
    if (onChange) return commit(nextTitle, nextXml, [], imported);
    onSave(nextTitle, nextXml, []);
    return true;
  };
  return <>
    <DiagramEditor presence={presence} cardId={`proc:${processId}`} live={onChange ? { state: saveState, onChange: save } : undefined} notation={bpmnCollaborationFacade} title={title} source={xml} onSave={save} onClose={onClose} />
    {pending && <WorkspaceActionDialog title="Удалить связанные привязки?" description={`${pending.imported ? 'Импорт заменит модель: совпадение ID не гарантирует совпадение элементов.' : 'Из модели исчезнут элементы, связанные с пунктами документов.'} При сохранении будут удалены привязки: ${pending.linkIds.length}. Отмените сохранение, если хотите сначала проверить изменения.`} confirmLabel="Сохранить и удалить привязки" danger busy={false} error={null} onClose={() => setPending(null)} onConfirm={async () => {
      if (onChange ? pending.baseXml !== xml : changedElsewhere()) { setPending(null); setConflict(true); return false; }
      const linkIds = affectedLinks(pending.xml, pending.imported);
      if (JSON.stringify(linkIds) !== JSON.stringify(pending.linkIds)) { setPending({ ...pending, linkIds }); return false; }
      if (onChange) { const accepted = commit(pending.title, pending.xml, pending.linkIds, pending.imported); if (accepted) setPending(null); return accepted; }
      onSave(pending.title, pending.xml, pending.linkIds); return true;
    }} />}
    {conflict && <WorkspaceActionDialog title="Модель изменилась" description="Пока редактор был открыт, модель изменилась вне него. Сохранение остановлено, чтобы не перезаписать изменения. Экспортируйте свою версию, затем закройте и откройте модель заново." confirmLabel="Понятно" busy={false} error={null} onClose={() => setConflict(false)} onConfirm={async () => true} />}
  </>;
}
