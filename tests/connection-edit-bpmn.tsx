import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { blankXml } from '../src/bpmn';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { bpmnNotation } from '../src/modeling/bpmn';

let source = bpmnNotation.addNode(blankXml('Проверка связей'), 'task', { x: 450, y: 140 });
source = bpmnNotation.addNode(source, 'task', { x: 500, y: 330 });
const nodes = bpmnNotation.read(source).diagram.nodes;
const from = nodes.find(node => node.type === 'startEvent')!;
const to = nodes.find(node => node.type === 'task' && node.x === 450)!;
source = bpmnNotation.connect(source, from.id, to.id);
const edge = bpmnNotation.read(source).diagram.edges[0];
source = bpmnNotation.rename(source, edge.id, 'Проверка BPMN');
const root = createRoot(document.getElementById('root')!);
function render() {
  root.render(<DiagramEditor key={source} notation={bpmnNotation} title="Проверка BPMN" source={source} onSave={(_title, saved) => { source = saved; (window as Window & { savedNotationSource?: string }).savedNotationSource = source; render(); }} onClose={() => {}} />);
}
render();