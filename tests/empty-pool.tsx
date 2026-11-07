import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { blankXml } from '../src/bpmn';
import { bpmnNotation } from '../src/modeling/bpmn';
import { bpmnCollaborationFacade } from '../src/modeling/bpmnCollaborationFacade';
import { DiagramEditor } from '../src/modeling/DiagramEditor';

const process = bpmnNotation.remove(blankXml('Пустая модель'), 'StartEvent_1');
const xml = bpmnCollaborationFacade.convertToCollaboration(process);
const root = document.getElementById('root');
if (!root) throw new Error('Не найден контейнер редактора');
createRoot(root).render(<DiagramEditor notation={bpmnCollaborationFacade} title="Пустая модель" source={xml} onSave={(_title, source) => { (window as Window & { savedXml?: string }).savedXml = source; }} onClose={() => {}} />);
