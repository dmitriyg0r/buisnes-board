import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { getModelNotation } from '../src/modeling/registry';
const notation = getModelNotation(new URLSearchParams(location.search).get('type') ?? '');
if (!notation) throw new Error('Нет нотации');
let source = notation.createEmpty();
const root = createRoot(document.getElementById('root')!);
function render() {
  root.render(<DiagramEditor key={source} notation={notation!} title="Тест нотации" source={source} onSave={(_title, saved) => { source = saved; (window as Window & { savedNotationSource?: string }).savedNotationSource = source; render(); }} onClose={() => {}} />);
}
render();
