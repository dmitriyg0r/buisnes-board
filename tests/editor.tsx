import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { blankXml } from '../src/bpmn';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { bpmnNotation } from '../src/modeling/bpmn';
import { bpmnCollaborationFacade } from '../src/modeling/bpmnCollaborationFacade';

let xml = blankXml('Тест редактора');
if (!bpmnNotation.addRegion) throw new Error('Дорожки не подключены');
xml = bpmnNotation.addRegion(xml, { x: 100, y: 100 });
xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 145 });
xml = bpmnNotation.addNode(xml, 'textAnnotation', { x: new URLSearchParams(location.search).has('wide-ports') ? 800 : 550, y: 140 });
const nodes = bpmnNotation.read(xml).diagram.nodes;
const task = nodes.find((node) => node.type === 'task');
const text = nodes.find((node) => node.type === 'textAnnotation');
if (!task || !text) throw new Error('Тестовые элементы не созданы');
xml = bpmnNotation.rename(xml, task.id, 'Проверить заявку');
xml = bpmnNotation.rename(xml, text.id, 'Комментарий');
xml = bpmnNotation.connect(xml, nodes[0].id, task.id);
xml = bpmnNotation.connect(xml, task.id, text.id);
if (new URLSearchParams(location.search).has('diagonal')) {
  const edge = bpmnNotation.read(xml).diagram.edges[0];
  const points = edge.points.map((p) => ({ ...p }));
  points[1].y += 13;
  xml = bpmnNotation.editEdge(xml, edge.id, edge.from, edge.to, points);
}
(window as Window & { editorFixture?: unknown }).editorFixture = { original: xml, taskId: task.id, annotationId: text.id, saved: null };
const root = document.getElementById('root');
if (!root) throw new Error('Корневой элемент не найден');
createRoot(root).render(<DiagramEditor notation={bpmnCollaborationFacade} title="Тест редактора" source={xml} onSave={(title, source, imported) => { (window as Window & { editorFixture?: unknown }).editorFixture = { original: xml, taskId: task.id, annotationId: text.id, saved: { title, source, imported } }; }} onClose={() => {}} />);
