import catalog from './aiToolCatalog.json';
import type { Issue } from './data';
import type { Settings } from './settings';

export interface AiAction { tool: string; key?: string; arguments: Record<string, unknown> }
export interface AiToolResult { ok: boolean; summary: string; data?: unknown; error?: string }
export interface AiObservation { action: AiAction; result: AiToolResult }
export interface CanvasRef { id: string; title: string; kind: 'proc' | 'doc' | 'html' | 'src' | 'gw' }
export interface AiEffect { tool: string; arguments: Record<string, unknown>; index: number }
export interface AiEnvironment {
  issues: Issue[];
  settings: Pick<Settings, 'grid' | 'snap' | 'minimap' | 'wheelZoom' | 'aiModel'>;
  view: { x: number; y: number; zoom: number; width: number; height: number; selectedIds: string[]; selectedLinkId?: string; tree: boolean; panel: boolean; mode: 'select' | 'link' | 'gateway' };
  canUndo: boolean;
  canRedo: boolean;
}
export interface AiToolHost {
  snapshot: () => AiEnvironment;
  execute: (effect: AiEffect) => Promise<AiToolResult>;
}

interface Schema {
  type?: string | string[]; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: boolean | Schema; items?: Schema; maxLength?: number; minLength?: number;
  minimum?: number; maximum?: number; maxItems?: number; minItems?: number; maxProperties?: number;
}
export const aiToolCatalog = catalog.tools as unknown as { name: string; description: string; parameters: Schema }[];

/** Один контракт проверяется и Rust-сервером, и клиентом, прежде чем менять данные. */
function validate(value: unknown, schema: Schema, path: string): void {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type && !types.includes(type)) throw new Error(`${path}: неверный тип значения`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: недопустимое значение ${String(value)}`);
  if (typeof value === 'string' && ([...value].length > (schema.maxLength ?? Infinity) || [...value].length < (schema.minLength ?? 0))) throw new Error(`${path}: недопустимая длина текста`);
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path}: число вне допустимого диапазона`);
  if (Array.isArray(value)) {
    if (value.length > (schema.maxItems ?? Infinity) || value.length < (schema.minItems ?? 0)) throw new Error(`${path}: недопустимое число элементов`);
    if (schema.items) value.forEach((item, i) => validate(item, schema.items!, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length > (schema.maxProperties ?? Infinity)) throw new Error(`${path}: слишком много свойств`);
    for (const required of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(record, required)) throw new Error(`${path}: не указано ${required}`);
    for (const [key, item] of Object.entries(record)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`${path}: недопустимое имя свойства`);
      const child = schema.properties?.[key];
      if (child) validate(item, child, `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${path}: неизвестное поле ${key}`);
      else if (typeof schema.additionalProperties === 'object') validate(item, schema.additionalProperties, `${path}.${key}`);
    }
  }
}

export function validateAiActions(value: unknown): asserts value is AiAction[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('В ответе допустимо не более 50 команд');
  const keys = new Set<string>();
  const keyOf = (key: unknown) => {
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key) || keys.has(key)) throw new Error('Ключи результатов должны быть корректными и уникальными внутри пакета');
    keys.add(key);
  };
  value.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Команда ${i + 1}: ожидается объект`);
    const action = raw as AiAction;
    if (Object.keys(raw).some((key) => !['tool', 'key', 'arguments'].includes(key))) throw new Error(`Команда ${i + 1}: неизвестное поле`);
    const tool = aiToolCatalog.find((tool) => tool.name === action.tool);
    if (!tool) throw new Error(`Команда ${i + 1}: неизвестный инструмент ${action.tool}`);
    if (action.key !== undefined) keyOf(action.key);
    if ((action.tool === 'create_object' || action.tool === 'create_issue') && !action.key) throw new Error(`Команда ${i + 1}: создание требует key`);
    validate(action.arguments, tool.parameters, `Команда ${i + 1} (${tool.name})`);
    if (action.tool === 'edit_bpmn') for (const operation of action.arguments.operations as Record<string, unknown>[]) if (operation.key !== undefined) keyOf(operation.key);
  });
  if (value.some((a) => a.tool.startsWith('read_')) && value.some((a) => !a.tool.startsWith('read_'))) throw new Error('Чтение выполняется отдельным шагом перед изменениями');
  if (value.some((a) => a.tool === 'history') && value.length !== 1) throw new Error('Отмена и повтор выполняются отдельной командой');
  if (value.reduce((sum, a) => sum + (a.tool === 'edit_bpmn' ? (a.arguments.operations as unknown[]).length : 0), 0) > 240) throw new Error('Слишком много операций BPMN в одном ответе');
}
