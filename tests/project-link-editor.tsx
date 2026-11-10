import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '../src/Canvas';
import { emptyModel, type Issue } from '../src/data';
import { defaultSettings } from '../src/settings';
import { useModel } from '../src/useModel';
import { modelKey, viewKey } from '../src/projects';
import '../src/styles.css';

const projectId = 'project-link-editor-test';
const issue: Issue = { id: 'check', title: 'Проверка', status: 'open', summary: '', question: '' };
localStorage.removeItem(modelKey(projectId)); localStorage.removeItem(viewKey(projectId));
function Fixture() {
  const api = useModel(projectId);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => api.setRemote({ ...structuredClone(emptyModel),
    docs: ['a', 'b', 'c'].map(id => ({ id, title: id, markdown: '', sections: [] })),
    ...(new URLSearchParams(location.search).has('manual') ? { cardLinks: [{ id: 'manual-link', from: 'doc:a', to: 'doc:b', label: 'Ручная связь', fromSide: 'right' as const, toSide: 'left' as const, fromOffset: 0.5, toOffset: 0.5, routePoints: [{ x: 300, y: 200 }, { x: 300, y: 350 }, { x: 580, y: 350 }, { x: 580, y: 200 }] }] } : {}),
    meta: { 'layout:pos': { 'doc:a': '80,120', 'doc:b': '600,120', 'doc:c': '600,420' }, 'layout:size': { 'doc:a': '200,160', 'doc:b': '200,160', 'doc:c': '200,160' } },
  }), []);
  return <div className="app"><header className="topbar"><b>Проверка связей проекта</b><output id="model" hidden>{JSON.stringify(api.model)}</output></header><div className="workspace" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
    <Canvas api={api} projectId={projectId} settings={{ ...defaultSettings, minimap: false }} onModel={() => {}} issues={[issue]} issue={issue} onSelect={() => {}} selCards={selected} onSelCards={setSelected} onAddMaterial={() => {}} onEditProcess={() => {}} onEditDoc={() => {}} onEditHtml={() => {}} onEditModel={() => {}} paused={false} aiPanels={{ tree: false, panel: false }} onAiWorkspaceEffect={async () => ({ ok: true, summary: '' })} />
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);