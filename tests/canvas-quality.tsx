import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '../src/Canvas';
import { IssuePanel } from '../src/IssuePanel';
import { Tree } from '../src/Tree';
import { coverage } from '../src/coverage';
import { emptyModel, type Issue } from '../src/data';
import { defaultSettings } from '../src/settings';
import { useModel } from '../src/useModel';
import '../src/styles.css';

function Fixture() {
  const api = useModel('canvas-quality-fixture');
  const [settings, setSettings] = useState(defaultSettings);
  const [selected, setSelected] = useState<string[]>([]);
  const [panel, setPanel] = useState(true);
  const issue: Issue = { id: 'check', title: 'Не определён лимит закупки', status: 'open', summary: 'Проверка названия документа', question: 'С какой суммы требуется согласование?', doc: { sectionId: 'section', label: 'Согласование' } };
  useEffect(() => api.setRemote({ ...structuredClone(emptyModel), docs: [{ id: 'doc', title: 'Регламент закупки — проверка', markdown: '## Согласование\n\nРуководитель проверяет заявку.', sections: [{ id: 'section', title: 'Согласование' }] }], htmlObjects: [{ id: 'html', title: 'Калькулятор закупки', html: '<h2>Стоимость</h2><input value="100"><output>300,00</output>' }], meta: { 'layout:pos': { 'doc:doc': '0,0', 'html:html': '600,200' }, 'layout:size': { 'doc:doc': '500,700', 'html:html': '360,400' } } }), []);
  return <div className="app"><header className="topbar"><b>Проверка канваса · локальный стенд</b></header><div className="workspace" style={{ gridTemplateColumns: `232px minmax(0, 1fr) ${panel ? '300px' : '44px'}` }}>
    <Tree sources={[]} processes={[]} docs={api.model.docs} htmlObjects={api.model.htmlObjects} onEditHtml={() => {}} selectedCards={selected} onAddMaterial={() => {}} collapsed={false} onToggle={() => {}} />
    <Canvas api={api} projectId="canvas-quality-fixture" settings={settings} onModel={(aiModel) => setSettings((old) => ({ ...old, aiModel }))} issues={[issue]} issue={issue} onSelect={() => setPanel(true)} selCards={selected} onSelCards={setSelected} onAddMaterial={() => {}} onEditProcess={() => {}} onEditDoc={() => {}} onEditHtml={() => {}} paused={false} aiPanels={{ tree: true, panel }} onAiWorkspaceEffect={async (effect) => { if (typeof effect.arguments.panel === 'boolean') setPanel(effect.arguments.panel); return { ok: true, summary: 'Вид настроен' }; }} />
    <IssuePanel docs={api.model.docs} issues={[issue]} issue={issue} cover={coverage(api.model)} onSelect={() => {}} index={0} total={1} onStep={() => {}} onTransition={() => {}} collapsed={!panel} onToggle={() => setPanel(!panel)} openCount={1} />
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
