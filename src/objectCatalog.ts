/** Каталог доступных типов отделён от реализации редакторов и хранения проекта. */
export type ObjectKind = 'process' | 'document' | 'html' | 'source';
export type ObjectCategoryId = 'processes' | 'documents' | 'html' | 'sources';
export type ObjectTypeId = 'bpmn' | 'markdown' | 'interactive-html' | 'source-reference';

interface ObjectType {
  id: ObjectTypeId;
  kind: ObjectKind;
  title: string;
  description: string;
  icon: 'model' | 'file' | 'code';
  format: string;
}

interface ObjectCategory {
  id: ObjectCategoryId;
  title: string;
  description: string;
  types: ObjectType[];
}

/** В каталог добавляются только типы, создание которых действительно поддерживается. */
export const objectCatalog: ObjectCategory[] = [
  {
    id: 'processes',
    title: 'Модели процессов',
    description: 'Диаграммы процессов и взаимодействий',
    types: [{ id: 'bpmn', kind: 'process', title: 'Модель процесса', description: 'Процесс с дорожками, событиями, действиями и переходами.', icon: 'model', format: 'BPMN' }],
  },
  {
    id: 'documents',
    title: 'Документы',
    description: 'Текстовые материалы проекта',
    types: [{ id: 'markdown', kind: 'document', title: 'Текстовый документ', description: 'Документ с заголовками и текстом; разделы можно связать с моделью.', icon: 'file', format: 'Markdown' }],
  },
  {
    id: 'html',
    title: 'HTML-объекты',
    description: 'Интерактивные виджеты и прототипы на доске',
    types: [{ id: 'interactive-html', kind: 'html', title: 'Интерактивный HTML', description: 'Свой HTML, CSS и JavaScript: формы, калькуляторы, графики и прототипы.', icon: 'code', format: 'HTML' }],
  },
  {
    id: 'sources',
    title: 'Источники',
    description: 'Материалы, на которые опирается проект',
    types: [{ id: 'source-reference', kind: 'source', title: 'Ссылка на источник', description: 'Карточка с названием, форматом и количеством страниц.', icon: 'file', format: 'PDF / DOCX' }],
  },
];
