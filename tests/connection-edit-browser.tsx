import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { epcNotation } from '../src/modeling/epc';

let source = epcNotation.createEmpty();
source = epcNotation.addNode(source, 'event', { x: 100, y: 100 });
source = epcNotation.addNode(source, 'function', { x: new URLSearchParams(location.search).has('short') ? 276 : 350, y: 100 });
source = epcNotation.addNode(source, 'function', { x: 500, y: 300 });
const [from, to] = epcNotation.read(source).diagram.nodes;
source = epcNotation.connect(source, from.id, to.id);
const edge = epcNotation.read(source).diagram.edges[0];
if (new URLSearchParams(location.search).has('short')) source = epcNotation.editEdge(source, edge.id, from.id, to.id, [{ x: 260, y: 132 }, { x: 276, y: 132 }]);
if (new URLSearchParams(location.search).has('bent')) source = epcNotation.editEdge(source, edge.id, from.id, to.id, [{ x: 260, y: 132 }, { x: 290, y: 132 }, { x: 290, y: 170 }, { x: 320, y: 170 }, { x: 320, y: 132 }, { x: 350, y: 132 }]);
source = epcNotation.rename(source, edge.id, 'Проверка');
const root = createRoot(document.getElementById('root')!);
function render() {
  root.render(<DiagramEditor key={source} notation={epcNotation} title="Проверка связей" source={source} onSave={(_title, saved) => { source = saved; (window as Window & { savedNotationSource?: string }).savedNotationSource = source; render(); }} onClose={() => {}} />);
}
render();