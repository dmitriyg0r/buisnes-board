import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { epcNotation } from '../src/modeling/epc';

let source = epcNotation.createEmpty();
source = epcNotation.addNode(source, 'event', { x: 100, y: 100 });
source = epcNotation.addNode(source, 'function', { x: 500, y: 100 });
const [from, to] = epcNotation.read(source).diagram.nodes;
source = epcNotation.connect(source, from.id, to.id);
const root = createRoot(document.getElementById('root')!);
function render() {
  root.render(<DiagramEditor key={source} notation={epcNotation} title="Проверка EPC" source={source} onSave={(_title, saved) => { source = saved; (window as Window & { savedNotationSource?: string }).savedNotationSource = source; render(); }} onClose={() => {}} />);
}
render();