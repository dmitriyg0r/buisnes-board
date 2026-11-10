import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '../src/Canvas';
import IndependentModelEditor from '../src/IndependentModelEditor';
import DiagramModelEditor from '../src/DiagramModelEditor';
import { blankXml } from '../src/bpmn';
import { emptyModel, type DocLink, type Issue, type Model } from '../src/data';
import { bpmnCollaborationFacade } from '../src/modeling/bpmnCollaborationFacade';
import { getModelNotation, modelDefinitions } from '../src/modeling/registry';
import { defaultSettings } from '../src/settings';
import { useModel } from '../src/useModel';
import { normalizeModel } from '../src/normalize';
import { usePresence } from '../src/presence';
import { useSync } from '../src/sync';
import '../src/styles.css';

async function start() {
  const response = await fetch('/tests/model-collaboration-config.json');
  if (!response.ok) throw new Error('Сначала подготовьте изолированный локальный сервер по инструкции tests/README.md.');
  const { projectId } = await response.json() as { projectId: string };
  const user = new URLSearchParams(location.search).get('user') === 'B' ? 'B' : 'A';
  const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `collab-${user.toLowerCase()}@example.test`, password: 'local-collaboration-test-only' }) });
  if (!login.ok) throw new Error('Временные тестовые пользователи не созданы.');
  const loaded = await fetch(`/api/projects/${projectId}/model`).then(r => r.json()) as { data: Model; version: number };
  loaded.data = normalizeModel(loaded.data);
  if (!loaded.data.models.length) {
    const model = structuredClone(emptyModel);
    for (const definition of modelDefinitions) {
      const notation = getModelNotation(definition.id)!;
      let source = notation.createEmpty();
      const type = definition.id === 'epc' ? 'function' : notation.symbols[0].type;
      source = notation.addNode(source, type, { x: 80, y: 100 }); source = notation.addNode(source, type, { x: 500, y: 260 });
      const [first, second] = notation.read(source).diagram.nodes;
      source = notation.rename(source, first.id, 'Первый элемент'); source = notation.rename(source, second.id, 'Второй элемент');
      model.models.push({ id: definition.id, notation: definition.id, title: `Совместная модель ${definition.format}`, source });
    }
    let xml = bpmnCollaborationFacade.addNode(blankXml('Совместная модель BPMN'), 'task', { x: 500, y: 160 });
    for (const [index, node] of bpmnCollaborationFacade.read(xml).diagram.nodes.entries()) xml = bpmnCollaborationFacade.rename(xml, node.id, index === 0 ? 'Первый элемент' : 'Второй элемент');
    model.processes = [{ id: 'bpmn', title: 'Совместная модель BPMN', xml }];
    const put = await fetch(`/api/projects/${projectId}/model`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: loaded.version, data: model }) });
    if (!put.ok) throw new Error('Не удалось подготовить тестовые модели.');
    loaded.data = model;
  }
  function Fixture() {
    const api = useModel(projectId);
    const [settings, setSettings] = useState(defaultSettings);
    const state = useSync(api, settings, patch => setSettings(old => ({ ...old, ...patch })), projectId);
    const presence = usePresence(projectId);
    const [selected, setSelected] = useState<string[]>([]);
    const [notation, setNotation] = useState('epc');
    const [opened, setOpened] = useState(true);
    useEffect(() => api.setRemote(loaded.data), []);
    const model = api.model.models.find(m => m.id === notation), process = api.model.processes[0];
    const save = (title: string, source: string, removed: string[] = [], restore: DocLink[] = []) => {
      const current = api.getModel();
      const old = notation === 'bpmn' ? current.processes[0] : current.models.find(m => m.id === notation);
      if (!old) return false;
      if (old.title === title && ('xml' in old ? old.xml : old.source) === source && !removed.length && !restore.length) return true;
      api.apply(m => notation === 'bpmn' ? { ...m, processes: m.processes.map(p => p.id === 'bpmn' ? { ...p, title, xml: source } : p), links: [...m.links.filter(link => !removed.includes(link.id)), ...restore.filter(link => !m.links.some(current => current.id === link.id))] } : { ...m, models: m.models.map(item => item.id === notation ? { ...item, title, source } : item) });
      return true;
    };
    const issue: Issue = { id: 'check', title: 'Совместное редактирование', summary: '', status: 'open', question: '' };
    return <div className="app"><header className="topbar"><b>Клиент {user} · локальный сервер</b><select aria-label="Проверяемая нотация" value={notation} onChange={event => { setOpened(false); setNotation(event.target.value); }}><option value="bpmn">BPMN</option>{modelDefinitions.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select><button onClick={() => setOpened(true)}>Открыть редактор</button><output id="sync-state">{state}</output><output id="snapshot" hidden>{JSON.stringify(api.model)}</output></header>
      <div className="workspace" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}><Canvas api={api} projectId={projectId} settings={settings} onModel={() => {}} issues={[issue]} issue={issue} onSelect={() => {}} selCards={selected} onSelCards={setSelected} onAddMaterial={() => {}} onEditProcess={() => { setNotation('bpmn'); setOpened(true); }} onEditDoc={() => {}} onEditHtml={() => {}} onEditModel={id => { setNotation(id); setOpened(true); }} paused={opened} presence={presence} aiPanels={{ tree: false, panel: false }} onAiWorkspaceEffect={async () => ({ ok: true, summary: '' })} /></div>
      {opened && (notation === 'bpmn' ? process && <DiagramModelEditor key={notation} title={process.title} xml={process.xml} processId={process.id} links={api.model.links} presence={presence} saveState={state} onChange={save} onSave={save} onClose={() => setOpened(false)} /> : model && <IndependentModelEditor key={notation} model={model} presence={presence} saveState={state} onChange={save} onSave={save} onClose={() => setOpened(false)} />)}
    </div>;
  }
  createRoot(document.getElementById('root')!).render(<Fixture />);
}
start().catch(error => { document.getElementById('root')!.textContent = String(error); });
