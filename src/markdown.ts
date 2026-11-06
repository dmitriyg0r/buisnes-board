import type { DocSection } from './data';

/** Кусок документа от заголовка до следующего заголовка. */
export interface MdChunk {
  kind: 'preface' | 'title' | 'section';
  /** заголовок без разметки; у preface пустой */
  title: string;
  /** исходный Markdown куска вместе со строкой заголовка */
  text: string;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;
/** Пунктами считаются заголовки до третьего уровня. */
const MAX_SECTION_LEVEL = 3;

const plain = (s: string) => s.replace(/[*_`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();

/**
 * Делит документ на куски по заголовкам. Единственный заголовок первого уровня в самом начале считается названием
 * документа, а не пунктом. Строки внутри блоков кода заголовками не считаются.
 */
export function splitMarkdown(md: string): MdChunk[] {
  const lines = md.split('\n');
  const marks: { line: number; level: number; title: string }[] = [];
  let fence = false;
  lines.forEach((ln, i) => {
    if (FENCE.test(ln)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const m = HEADING.exec(ln);
    if (m) marks.push({ line: i, level: m[1].length, title: plain(m[2]) });
  });

  const firstIsTitle = marks.length > 0 && marks[0].level === 1 && marks.filter((h) => h.level === 1).length === 1;
  const cuts = marks.filter((h, i) => h.level <= MAX_SECTION_LEVEL || (i === 0 && firstIsTitle));
  const chunks: MdChunk[] = [];
  const first = cuts.length ? cuts[0].line : lines.length;
  const preface = lines.slice(0, first).join('\n');
  if (preface.trim()) chunks.push({ kind: 'preface', title: '', text: preface });
  cuts.forEach((h, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1].line : lines.length;
    chunks.push({ kind: i === 0 && firstIsTitle ? 'title' : 'section', title: h.title, text: lines.slice(h.line, end).join('\n') });
  });
  return chunks;
}

export const sectionTitles = (md: string) => splitMarkdown(md).filter((c) => c.kind === 'section').map((c) => c.title);

export const newSectionId = () => 's' + Math.random().toString(36).slice(2, 8);

/**
 * Подбирает идентификаторы пунктам после правки текста, чтобы связи с шагами не терялись:
 * сначала пункты с тем же заголовком, затем (если число оставшихся совпало) переименованные по порядку.
 */
export function reconcileSections(old: DocSection[], titles: string[]): DocSection[] {
  const result: (DocSection | null)[] = titles.map(() => null);
  const used = new Set<string>();

  titles.forEach((t, i) => {
    const hit = old.find((o) => !used.has(o.id) && o.title === t);
    if (hit) {
      used.add(hit.id);
      result[i] = { id: hit.id, title: t };
    }
  });

  const freeNew = result.flatMap((r, i) => (r ? [] : [i]));
  const freeOld = old.filter((o) => !used.has(o.id));
  freeNew.forEach((i, n) => {
    const same = freeNew.length === freeOld.length;
    result[i] = { id: same ? freeOld[n].id : newSectionId(), title: titles[i] };
  });
  return result as DocSection[];
}

/** Начальный текст нового документа. */
export const starterMarkdown = (title: string) => `# ${title}\n\n`;
