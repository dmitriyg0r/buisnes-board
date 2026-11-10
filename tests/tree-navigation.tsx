import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tree } from '../src/Tree';
import { Canvas } from '../src/Canvas';
import { emptyModel, type Issue } from '../src/data';
import { blankXml } from '../src/bpmn';
import { getModelNotation } from '../src/modeling/registry';
import { useModel } from '../src/useModel';
import { defaultSettings } from '../src/settings';
import { modelKey, viewKey } from '../src/projects';
import '../src/styles.css';

const projectId = 'tree-navigation-test';
const names = ['Оформление заявки с длинным названием', 'Структура заявки', 'Процесс согласования'];
function Fixture() {
  const api = useModel(projectId);
  const [selected, setSelected] = useState<string[]>([]);
  const [request, setRequest] = useState<{ id: string; action: 'find' | 'delete' } | null>(null);
  const [opened, setOpened] = useState('');
  useEffect(() => api.setRemote({ ...structuredClone(emptyModel),
    models: [{ id: 'epc', title: names[0], notation: 'epc', source: getModelNotation('epc')!.createEmpty() }, { id: 'uml', title: names[1], notation: 'uml-class', source: getModelNotation('uml-class')!.createEmpty() }],
    processes: [{ id: 'proc', title: names[2], xml: blankXml(names[2]) }],
    cardLinks: [{ id: 'link', from: 'model:epc', to: 'model:uml', label: 'Связь моделей' }],
    meta: { 'layout:pos': { 'model:epc': '5000,3000', 'model:uml': '-4000,-2000', 'proc:proc': '10000,8000' } },
  }), []);
  const issue: Issue = { id: 'check', title: 'Поиск моделей', status: 'open', summary: '', question: '' };
  return <div className="app"><header className="topbar"><b>Поиск моделей · локальная проверка</b><output id="result">Выполняется…</output><output id="opened" hidden>{opened}</output><output id="link-count" hidden>{api.model.cardLinks.length}</output></header><div className="workspace" style={{ gridTemplateColumns: '232px minmax(0, 1fr)' }}>
    <Tree sources={[]} docs={[]} processes={api.model.processes} models={api.model.models} onEditModel={setOpened} onFindCard={id => { setSelected([id]); setRequest({ id, action: 'find' }); }} onDeleteCard={id => setRequest({ id, action: 'delete' })} htmlObjects={[]} onEditHtml={() => {}} selectedCards={selected} onAddMaterial={() => {}} collapsed={false} onToggle={() => {}} />
    <Canvas api={api} projectId={projectId} settings={defaultSettings} onModel={() => {}} issues={[issue]} issue={issue} onSelect={() => {}} selCards={selected} onSelCards={setSelected} cardRequest={request} onAddMaterial={() => {}} onEditProcess={() => {}} onEditDoc={() => {}} onEditHtml={() => {}} onEditModel={setOpened} paused={false} aiPanels={{ tree: true, panel: false }} onAiWorkspaceEffect={async () => ({ ok: true, summary: '' })} />
  </div></div>;
}
localStorage.removeItem(modelKey(projectId)); localStorage.removeItem(viewKey(projectId));
createRoot(document.getElementById('root')!).render(<Fixture />);
const pause = () => new Promise(resolve => setTimeout(resolve, 120));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const find = (name: string) => document.querySelector<HTMLButtonElement>(`.tree [aria-label="Действия с моделью: ${name}"]`)!;
const menuAction = async (name: string, action: string) => {
  find(name).click(); await pause();
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(item => item.textContent === action);
  assert(item, `Нет пункта ${action}`); item!.click(); await pause();
};
const checkVisible = (id: string) => {
  const card = document.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
  const rect = card.getBoundingClientRect(), area = document.querySelector('.canvas')!.getBoundingClientRect();
  const chat = document.querySelector('.ai-bar')!.getBoundingClientRect();
  assert(rect.left >= area.left && rect.right <= area.right && rect.top >= area.top && rect.bottom <= Math.min(area.bottom, chat.top) + 1, `Карточка ${id} вне рабочей области`);
  assert(card.classList.contains('sel'), `Карточка ${id} не выделена`);
  return rect;
};
try {
  await pause(); await pause(); await pause();
  assert(!document.querySelector('.tree small'), 'Осталась подпись нотации');
  assert(!document.querySelector('.tree [aria-label^="Удалить модель"]'), 'Осталась корзина');
  const icons = Array.from(document.querySelectorAll<SVGSVGElement>('.tree-row > svg'));
  assert(icons.length === 3 && icons.every(icon => icon.getBoundingClientRect().width === 16 && icon.querySelector('path')!.getAttribute('d') === icons[0].querySelector('path')!.getAttribute('d')), 'Значки отличаются или сжимаются');
  for (const [index, id] of ['model:epc', 'model:uml', 'proc:proc'].entries()) {
    await menuAction(names[index], 'Найти на канвасе'); checkVisible(id);
    assert(find(names[index]).closest('.tree-row')!.classList.contains('sel'), 'Модель не выделена в дереве');
  }
  await menuAction(names[0], 'Найти на канвасе');
  const before = checkVisible('model:epc').width;
  document.querySelector<HTMLButtonElement>('[aria-label="Уменьшить"]')!.click(); await pause();
  assert(checkVisible('model:epc').width < before, 'Не изменился масштаб');
  await menuAction(names[0], 'Найти на канвасе');
  assert(Math.abs(checkVisible('model:epc').width - before) < 1, 'Повторный поиск той же модели не восстановил масштаб');
  document.querySelector<HTMLButtonElement>(`.tree [aria-label="Открыть модель: ${names[0]}"]`)!.click(); await pause();
  assert(document.querySelector('#opened')!.textContent === 'epc', 'Открытие редактора не работает');
  find(names[0]).click(); await pause();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
  assert(!document.querySelector('[role="menu"]') && document.activeElement === find(names[0]), 'Escape не закрыл меню или не вернул фокус');
  checkVisible('model:epc');
  for (const [index, id] of ['model:epc', 'model:uml', 'proc:proc'].entries()) {
    await menuAction(names[index], 'Удалить');
    assert(!document.querySelector(`[data-card="${id}"]`), `Модель ${id} осталась на канвасе`);
    assert(!find(names[index]), `Модель ${id} осталась в дереве`);
    if (index < 2) assert(document.querySelector('#link-count')!.textContent === '0', 'Связи удалённой модели остались');
    document.querySelector<HTMLButtonElement>('[aria-label="Шаг назад"]')!.click(); await pause();
    assert(document.querySelector(`[data-card="${id}"]`) && find(names[index]), 'Отмена не восстановила модель');
    assert(document.querySelector('#link-count')!.textContent === '1', 'Отмена не восстановила связи');
  }

  const result = document.querySelector<HTMLOutputElement>('#result')!;
  result.textContent = 'Пройдено: единые значки, отсутствие корзин и подписей, меню ⋯, поиск EPC/UML/BPMN, повторный поиск, редактор, удаление со связями и отмена.'; result.dataset.status = 'passed';
} catch (error) {
  const result = document.querySelector<HTMLOutputElement>('#result')!;
  result.textContent = `Ошибка: ${error instanceof Error ? error.message : error}`; result.dataset.status = 'failed';
}
