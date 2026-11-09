import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { blankXml } from '../src/bpmn';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { bpmnNotation } from '../src/modeling/bpmn';
let xml = blankXml('Интервалы');
for (const x of [100, 300, 540]) xml = bpmnNotation.addNode(xml, 'task', { x, y: 120 });
createRoot(document.getElementById('root')!).render(<DiagramEditor notation={bpmnNotation} title="Интервалы" source={xml} onSave={() => {}} onClose={() => {}} />);
