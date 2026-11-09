import assert from 'node:assert/strict';
import { normalizeModel } from '../src/normalize';
import { mergeModel } from '../src/mergeModel';

const source = { id: 'u1', title: 'Диаграмма', notation: 'unknown-future', source: '{"future":true}', extra: { keep: true } };
const legacy = normalizeModel({ processes: [{ id: 'p1', title: 'Процесс', xml: '<xml />' }], docs: [{ id: 'd1', title: 'Документ', markdown: '# Документ', sections: [] }] });
assert.deepEqual(legacy.models, []);
assert.equal(legacy.processes[0].xml, '<xml />');
const remote = normalizeModel({ ...legacy, models: [source] });
assert.deepEqual(JSON.parse(JSON.stringify(remote.models[0])), source);
assert.deepEqual(normalizeModel(JSON.parse(JSON.stringify(remote))).models, [source]);
const local = { ...legacy, docs: [{ ...legacy.docs[0], title: 'Правка' }] };
assert.deepEqual(mergeModel(legacy, local, remote).models, [source]);
assert.equal(mergeModel(legacy, local, remote).docs[0].title, 'Правка');
assert.deepEqual(mergeModel(remote, { ...remote, models: [] }, remote).models, []);
assert.deepEqual(mergeModel(remote, { ...remote, models: [] }, { ...remote, models: [{ ...source, title: 'Другая правка' }] }).models[0].title, 'Другая правка');
assert.throws(() => normalizeModel({ models: [{ id: 'broken' }] }), /Некорректные независимые модели/);
console.log('Независимые модели: нормализация, round-trip и слияние проверены');

const concurrentLocal = { ...remote, models: [{ ...source, title: 'Локальное имя' }] };
const concurrentRemote = { ...remote, models: [{ ...source, source: 'новое содержимое', extra: { keep: 'новое' } }] };
assert.deepEqual(mergeModel(remote, concurrentLocal, concurrentRemote).models[0], { ...source, title: 'Локальное имя', source: 'новое содержимое', extra: { keep: 'новое' } });
