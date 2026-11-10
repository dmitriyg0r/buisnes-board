import { useState } from 'react';
import { AiChat } from '../src/AiChat';
import { useModel } from '../src/useModel';
import { mergeDiagramSource } from '../src/modeling/mergeSource';
import { createRoot } from 'react-dom/client';
import { blankXml } from '../src/bpmn';
import { DiagramEditor } from '../src/modeling/DiagramEditor';
import { bpmnCollaborationFacade as bpmn } from '../src/modeling/bpmnCollaborationFacade';
import { epcNotation } from '../src/modeling/epc';
import { umlUseCaseNotation as useCase } from '../src/modeling/umlUseCase';
import { umlSequenceNotation as sequence, parseSequence } from '../src/modeling/umlSequence';
import { hasSelfIntersections, routeConflictCost } from '../src/modeling/orthogonalRouting';
import { segmentCrossesNode, endpointsFaceOutward, routeBetweenNodes } from '../src/modeling/diagramRouting';
import { planAiActions } from '../src/aiCanvasTools';
import { emptyModel } from '../src/data';
import type { DiagramNotation, Diagram } from '../src/modeling/types';
import type { AiAction } from '../src/aiToolContract';
import '../src/styles.css';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const lastNode = (n: DiagramNotation, source: string) => n.read(source).diagram.nodes.at(-1)!.id;
function geometry(n: DiagramNotation, diagram: Diagram) {
  for (const edge of diagram.edges) {
    assert(!hasSelfIntersections(edge.points), `${edge.id}: излом/самопересечение`);
    assert(endpointsFaceOutward(edge.points, diagram.nodes.find(x => x.id === edge.from)!, diagram.nodes.find(x => x.id === edge.to)!, x => n.symbols.find(s => s.type === x.type)?.shape), `${edge.id}: обратный вход`);
    assert(!edge.points.slice(1).some((p, i) => diagram.nodes.some(node => !n.symbols.find(s => s.type === node.type)?.container && !(i === 0 && node.id === edge.from) && !(i === edge.points.length - 2 && node.id === edge.to) && segmentCrossesNode(edge.points[i], p, node))), `${edge.id}: пересечение фигуры`);
  }
}
function buildBpmn() {
  let source = blankXml('Кофе до поезда');
  const lanes: string[] = [];
  for (const [i, name] of ['Пассажир', 'Система', 'Бариста', 'Робот-курьер', 'Оператор'].entries()) {
    source = bpmn.addRegion!(source, { x: 40, y: 40 + i * 260 });
    const id = bpmn.read(source).diagram.regions!.at(-1)!.id;
    source = bpmn.resizeRegion!(source, id, 3000, 220); source = bpmn.rename(source, id, name); lanes.push(id);
  }
  source = bpmn.moveNode(source, 'StartEvent_1', { x: 120, y: 120 });
  const ids = ['StartEvent_1'];
  for (const [type, label, x, lane] of [
    ['userTask', 'Оформить заказ', 240, 0], ['exclusiveGateway', 'Успеваем?', 440, 1],
    ['serviceTask', 'Предложить самовывоз', 640, 1], ['userTask', 'Оплатить заказ', 640, 0],
    ['exclusiveGateway', 'Оплата успешна?', 840, 1], ['endEvent', 'Отказ оплаты', 1040, 1],
    ['manualTask', 'Приготовить кофе', 1040, 2], ['exclusiveGateway', 'Робот доступен?', 1240, 1],
    ['userTask', 'Устранить сбой', 1440, 4], ['serviceTask', 'Доставить кофе', 1640, 3],
    ['exclusiveGateway', 'Срок соблюдён?', 1840, 1], ['serviceTask', 'Вернуть деньги', 2040, 1],
    ['userTask', 'Подтвердить выдачу', 2040, 0], ['endEvent', 'Заказ закрыт', 2240, 1],
  ] as [string, string, number, number][]) {
    source = bpmn.addNode(source, type, { x, y: 120 + lane * 260 });
    const id = lastNode(bpmn, source); source = bpmn.rename(source, id, label); ids.push(id);
  }
  for (const [a, b] of [[0,1],[1,2],[2,3],[2,4],[4,5],[5,6],[5,7],[7,8],[8,9],[8,10],[9,10],[10,11],[11,12],[11,13],[13,14]]) source = bpmn.connect(source, ids[a], ids[b]);
  // Подпись и ID должны пережить раскладку.
  const branch = bpmn.read(source).diagram.edges.find(e => e.from === ids[2] && e.to === ids[3])!;
  source = bpmn.rename(source, branch.id, 'Нет — самовывоз');
  // Воспроизводим прежнюю прокладку каждой связи независимо от соседних.
  const diagram = bpmn.read(source).diagram;
  for (const edge of diagram.edges) {
    const points = routeBetweenNodes(diagram.nodes, diagram.nodes.find(n => n.id === edge.from)!, diagram.nodes.find(n => n.id === edge.to)!, undefined, undefined, n => bpmn.symbols.find(s => s.type === n.type)?.shape)!;
    source = bpmn.editEdge(source, edge.id, edge.from, edge.to, points);
  }
  return source;
}
function buildUseCase() {
  let source = useCase.createEmpty();
  source = useCase.addNode(source, 'system-boundary', { x: 250, y: 60 });
  const frame = lastNode(useCase, source); source = useCase.rename(source, frame, 'Кофе до поезда');
  const ids: string[] = [];
  for (const [type, name, x, y] of [['actor','Пассажир',80,160],['actor','Оператор',960,160],['use-case','Оформить заказ',300,140],['use-case','Подтвердить получение',600,140],['use-case','Получить возврат',300,310],['use-case','Устранить сбой',600,310]] as [string,string,number,number][]) {
    source = useCase.addNode(source,type,{x,y}); const id = lastNode(useCase,source); source=useCase.rename(source,id,name);ids.push(id);
  }
  for (const [a,b] of [[0,2],[0,3],[0,4],[1,5]]) source = useCase.connect(source,ids[a],ids[b],'association');
  return source;
}
function buildEpc() {
  let source = epcNotation.createEmpty(); const ids: string[]=[];
  for (const [i,type] of ['event','function','xor','event','event','function','event'].entries()) {
    source=epcNotation.addNode(source,type,{x:i*240,y:i%2*160}); const id=lastNode(epcNotation,source);source=epcNotation.rename(source,id,['Заказ получен','Проверить срок','','Успеваем','Не успеваем','Приготовить кофе','Кофе готов'][i]);ids.push(id);
  }
  for(const [a,b] of [[0,1],[1,2],[2,3],[2,4],[3,5],[5,6]]) source=epcNotation.connect(source,ids[a],ids[b],'flow');
  source=epcNotation.addNode(source,'role',{x:-250,y:100});const role=lastNode(epcNotation,source);source=epcNotation.rename(source,role,'Бариста');source=epcNotation.connect(source,role,ids[5],'resource');return source;
}
const reports: string[]=[];
let fixtures: Record<string,{notation:DiagramNotation;source:string}>={};
try {
  const started=performance.now(); const source=buildBpmn(), before=bpmn.read(source).diagram;
  const laid=bpmn.autoLayout!(source), after=bpmn.read(laid).diagram;
  assert(!bpmn.read(laid).readOnlyReason,'BPMN стал read-only');
  assert(after.nodes.map(n=>n.id).join()===before.nodes.map(n=>n.id).join(),'BPMN изменил ID');
  assert(after.edges.map(e=>`${e.id}:${e.from}:${e.to}:${e.label}`).join()===before.edges.map(e=>`${e.id}:${e.from}:${e.to}:${e.label}`).join(),'BPMN изменил смысл связей');
  const lanes=after.regions!.sort((a,b)=>a.y-b.y);
  assert(lanes.every((r,i)=>!i||r.y===lanes[i-1].y+lanes[i-1].height),'Между дорожками есть разрывы');
  assert(lanes.every(r=>r.x===lanes[0].x&&r.width===lanes[0].width),'Ширина дорожек отличается');
  geometry(bpmn,after);
  const overlaps=(d:Diagram)=>d.edges.reduce((sum,e,i)=>sum+e.points.slice(1).reduce((s,p,k)=>s+routeConflictCost(e.points[k],p,d.edges.slice(0,i).map(e=>e.points)),0),0);
  assert(overlaps(after)<overlaps(before),'Раскладка не уменьшила конфликты маршрутов');
  reports.push(`BPMN: дорожки, ID, подписи, ветвление, обход фигур — OK; штраф маршрутов ${overlaps(before)} → ${overlaps(after)}; ${Math.round(performance.now()-started)} мс`);
  let collab=bpmn.convertToCollaboration(source); collab=bpmn.addPool!(collab,{x:40,y:1500}); const participants=bpmn.read(collab).diagram.regions!.filter(r=>r.kind==='pool'); collab=bpmn.connect(collab,participants[0].id,participants[1].id,'messageFlow'); const collabAfter=bpmn.autoLayout!(collab); assert(!bpmn.read(collabAfter).readOnlyReason,'Collaboration повреждена'); reports.push('BPMN collaboration: пулы и поток сообщений сохранены — OK');
  const uc=useCase.autoLayout!(buildUseCase()); geometry(useCase,useCase.read(uc).diagram);
  const frame=useCase.read(uc).diagram.nodes.find(n=>n.type==='system-boundary')!;
  const moved=useCase.read(useCase.moveNode(uc,frame.id,{x:frame.x+40,y:frame.y+20})).diagram;
  assert(moved.nodes.filter(n=>n.type==='use-case').every(n=>n.x===useCase.read(uc).diagram.nodes.find(o=>o.id===n.id)!.x+40),'Лист не перемещает содержимое');
  geometry(useCase,moved);
  const extra=useCase.addNode(uc,'system-boundary',{x:250,y:800});
  const sheets=useCase.read(useCase.autoLayout!(extra)).diagram.nodes.filter(n=>n.type==='system-boundary');
  assert(sheets[0].y+sheets[0].height<=sheets[1].y,'Листы наложились друг на друга');
  const cases=useCase.read(uc).diagram.nodes.filter(n=>n.type==='use-case');
  const left=useCase.moveNode(uc,cases[0].id,{x:cases[0].x+20,y:cases[0].y+20});
  const right=useCase.moveNode(uc,cases[1].id,{x:cases[1].x+20,y:cases[1].y+20});
  geometry(useCase,useCase.read(mergeDiagramSource(uc,left,right,'uml-use-case')).diagram);
  reports.push('UML: лист, внутренние связи, перенос с содержимым — OK');
  const epc=epcNotation.autoLayout!(buildEpc()); geometry(epcNotation,epcNotation.read(epc).diagram); reports.push('EPC: развилка и исполнитель, ортогональные маршруты — OK');
  let seq=sequence.createEmpty();seq=sequence.addNode(seq,'lifeline',{x:100,y:50});const a=lastNode(sequence,seq);seq=sequence.addNode(seq,'lifeline',{x:400,y:50});const b=lastNode(sequence,seq);
  seq=sequence.timeline!.addMessage(seq,a,b,900,'sync');const message=parseSequence(seq).messages[0];seq=sequence.rename(seq,message.id,'Принять заказ');seq=sequence.timeline!.moveMessage(seq,message.id,1100,1100);
  assert(parseSequence(seq).lifelines.every(l=>l.endY>=1100),'Линии жизни не продлены');
  let rejected=false;try{sequence.timeline!.addMessage(seq,a,b,20)}catch{rejected=true}assert(rejected,'Сообщение поверх заголовка принято');reports.push('Sequence: продолжение длинной линии жизни и отказ поверх заголовка — OK');
  const actions:AiAction[]=[{tool:'create_object',key:'p',arguments:{kind:'process',title:'Процесс'}},{tool:'edit_bpmn',arguments:{processId:'$p',operations:[{op:'auto_layout'}]}},{tool:'create_object',key:'u',arguments:{kind:'model',notation:'uml-use-case',title:'Сервис'}},{tool:'edit_model',arguments:{modelId:'$u',operations:[{op:'add_node',type:'system-boundary',x:0,y:0},{op:'auto_layout'}]}}];
  const plan=planAiActions(emptyModel,actions,{issues:[]});assert(plan.observations.every(o=>o.result.ok),'Инструменты ИИ отказали');reports.push('ИИ: общий контракт → клиент → адаптер → результат — OK');
  fixtures={raw:{notation:bpmn,source},bpmn:{notation:bpmn,source:laid},epc:{notation:epcNotation,source:epc},uml:{notation:useCase,source:uc},sequence:{notation:sequence,source:seq}};
}catch(error){reports.push(`FAIL: ${error instanceof Error?error.stack:error}`);console.error(error)}
function App(){const api=useModel('diagram-layout-fixture');const [opened,setOpened]=useState<string|null>(null);return <><pre id="result" style={{padding:20,whiteSpace:'pre-wrap'}}>{reports.join('\n')}</pre>{Object.keys(fixtures).map(key=><button key={key} onClick={()=>setOpened(key)}>Открыть {key}</button>)}<AiChat projectId="diagram-layout-fixture" api={api} aiModel="6.1-sol" onModel={()=>{}} onReveal={()=>{}} onFocusCard={()=>{}} tools={{snapshot:()=>({issues:[]}),execute:async()=>({ok:true,summary:'Тест'})}}/>{opened&&<DiagramEditor key={opened} notation={fixtures[opened].notation} source={fixtures[opened].source} title="Кофе до поезда" onSave={()=>{}} onClose={()=>setOpened(null)}/>}</>}
createRoot(document.querySelector('#root')!).render(<App/>);
