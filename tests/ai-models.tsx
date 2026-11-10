import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { planAiActions } from '../src/aiCanvasTools';
import { emptyModel, type IndependentModel } from '../src/data';
import type { AiAction, AiEnvironment } from '../src/aiToolContract';
import { defaultSettings } from '../src/settings';
import { IndependentModelPreview } from '../src/Canvas';
import IndependentModelEditor from '../src/IndependentModelEditor';
import { modelDefinitions, getModelNotation } from '../src/modeling/registry';
import '../src/styles.css';

const env: AiEnvironment = { issues: [], settings: defaultSettings, view: { x: 0, y: 0, zoom: 1, width: 1200, height: 800, selectedIds: [], tree: false, panel: false, mode: 'select' }, canUndo: false, canRedo: false };
const actions: AiAction[] = modelDefinitions.flatMap(({ id, title }, i) => {
  const n = getModelNotation(id)!;
  const types = id === 'epc' ? ['event', 'function'] : id === 'uml-use-case' ? ['actor', 'use-case'] : id === 'uml-activity' ? ['initial', 'action'] : [n.symbols[0].type, n.symbols[0].type];
  return [{ tool: 'create_object', key: `m${i}`, arguments: { kind: 'model', notation: id, title: `Заказы — ${title}` } }, { tool: 'edit_model', arguments: { modelId: `$m${i}`, operations: [
    { op: 'add_node', type: types[0], x: 40, y: 60, key: `a${i}` },
    { op: 'rename', id: `$a${i}`, name: id === 'epc' ? 'Заказ получен' : 'Заказчик' },
    { op: 'add_node', type: types[1], x: 400, y: 60, key: `b${i}` },
    { op: 'rename', id: `$b${i}`, name: id === 'epc' ? 'Обработать заказ' : 'Оформление заказа' },
    ...(id === 'uml-sequence' ? [{ op: 'add_message', from: `$a${i}`, to: `$b${i}`, y: 180, type: 'sync', key: `e${i}` }, { op: 'rename', id: `$e${i}`, name: 'Создать заказ' }] : [{ op: 'connect', from: `$a${i}`, to: `$b${i}`, key: `e${i}` }]),
  ] } }];
});
const generated = planAiActions(emptyModel, actions, env);
function Preview() {
  const [models, setModels] = useState(generated.model.models);
  const [editing, setEditing] = useState<IndependentModel | null>(null);
  return <div style={{ padding: 24 }}><h1>EPC/UML через инструменты ИИ</h1><p>Фиксированные команды create_object и edit_model; без вызова настоящей модели и записи на сервер.</p>
    {models.map(m => <section key={m.id} style={{ display: 'inline-block', verticalAlign: 'top', width: 500, margin: 10 }}><h2>{m.title}</h2><button onClick={() => setEditing(m)}>Редактировать {m.notation}</button><div style={{ height: 320, border: '1px solid #bbb' }}><IndependentModelPreview model={m} /></div></section>)}
    {editing && <IndependentModelEditor model={editing} onClose={() => setEditing(null)} onSave={(title, source) => { setModels(items => items.map(m => m.id === editing.id ? { ...m, title, source } : m)); setEditing(null); }} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
