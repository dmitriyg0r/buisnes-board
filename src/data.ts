export type IssueStatus = 'open' | 'asked' | 'answered' | 'fixed' | 'closed';

export interface HistoryEntry {
  status: IssueStatus;
  at: string;
  note?: string;
}

export interface Issue {
  id: string;
  title: string;
  status: IssueStatus;
  model?: { nodeId: string; edgeId?: string; label: string; step: string };
  doc?: { sectionId: string; label: string };
  summary: string;
  basis?: { sourceId: string; source: string; fragment: string; quote: string };
  /** замечание найдено автоматически по покрытию связей */
  auto?: boolean;
  /** ответ владельца процесса */
  answer?: string;
  /** что изменили в модели или регламенте */
  resolution?: string;
  history?: HistoryEntry[];
  question: string;
}

export interface Source {
  id: string;
  name: string;
  ext: 'PDF' | 'DOCX';
  pages: number;
}



/** Пункт документа: заголовок в Markdown. Идентификатор переживает правку заголовков, поэтому на него можно ссылаться. */
export interface DocSection {
  id: string;
  title: string;
}

/** Документ проекта: Markdown и пункты, найденные в нём по заголовкам. */
export interface Doc {
  id: string;
  title: string;
  markdown: string;
  sections: DocSection[];
}

/** Связь «Описывает»: шаг модели ↔ пункт документа. nodeId составной: «<id модели>:<id элемента BPMN>». */
export interface DocLink {
  id: string;
  nodeId: string;
  sectionId: string;
}

/** Модель процесса: название и BPMN 2.0 XML. */
export interface Process {
  id: string;
  title: string;
  xml: string;
}

/** Связь между карточками на доске: источник → документ, модель → документ и т. п. */
export interface CardLink {
  id: string;
  /** id карточки: proc:<id>, doc:<id> или src:<id> */
  from: string;
  to: string;
  label: string;
}

/** Шлюз на доске: ромб-развилка между карточками, к нему можно проводить связи. */
export interface Gateway {
  id: string;
  label: string;
}

export interface Model {
  /** шлюзы на доске */
  gateways: Gateway[];
  links: DocLink[];
  /** связи между карточками */
  cardLinks: CardLink[];
  /** модели процессов на доске */
  processes: Process[];
  /** документы проекта */
  docs: Doc[];
  /** источники проекта */
  sources: Source[];
  /** произвольные атрибуты объектов: ключ вида node:id, edge:id, section:id, card:id */
  meta: Record<string, Record<string, string>>;
}

/** Короткая ссылка на пункт: «§ 4.2». */
export const sectionRef = (title: string) => title.match(/^§\s*\d+(?:\.\d+)*/)?.[0] ?? title;

export const emptyModel: Model = { gateways: [], links: [], cardLinks: [], processes: [], docs: [], sources: [], meta: {} };

/** Заглушка, когда замечаний нет: ничего не подсвечивает. */
export const NO_ISSUE: Issue = { id: '', title: '', status: 'open', summary: '', question: '' };

export const MODEL_SIZE = { w: 540, h: 692 };
export const DOC_SIZE = { w: 340, h: 460 };
export const SOURCE_SIZE = { w: 168, h: 216 };
export const GATEWAY_SIZE = { w: 132, h: 132 };
