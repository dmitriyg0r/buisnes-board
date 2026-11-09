import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { umlSequenceNotation } from '../src/modeling/umlSequence';
createRoot(document.getElementById('root')!).render(<DiagramEditor notation={umlSequenceNotation} title="Тест" source={umlSequenceNotation.createEmpty()} onSave={(_title, source) => { (window as unknown as { saved: string }).saved = source; }} onClose={() => {}} />);
