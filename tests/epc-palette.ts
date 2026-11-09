import assert from 'node:assert/strict';
import { epcNotation, epcSymbols } from '../src/modeling/epc';
import { nodeLabelBounds } from '../src/modeling/DiagramEditor';

const contrast = (fill: string, foreground: string) => {
  const mix = /^color-mix\(in srgb, (#[\da-f]{6}) (\d+)%, white\)$/i.exec(fill);
  if (!mix) throw new Error(`Неожиданная заливка: ${fill}`);
  const amount = Number(mix[2]) / 100;
  const luminance = (channels: number[]) => channels.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const background = luminance(rgb(mix[1]).map(c => c * amount + (1 - amount)));
  const text = luminance(rgb(foreground));
  return (Math.max(background, text) + .05) / (Math.min(background, text) + .05);
};
for (const symbol of epcSymbols) {
  const a = symbol.appearance!;
  assert.ok(contrast(a.fill, a.textColor!) >= 4.5, `${symbol.type}: недостаточный контраст`);
  if (a.icon) {
    const n = { id: 'old', type: symbol.type, label: 'Текст', x: 42, y: 71, width: 100, height: 55 };
    const b = nodeLabelBounds(n, symbol);
    assert.ok(b.x > n.x && b.x + b.width <= n.x + n.width);
    assert.equal(b.y + b.height / 2, n.y + n.height / 2);
    const custom = { x: 200, y: 300, width: 80, height: 25 };
    assert.deepEqual(nodeLabelBounds({ ...n, labelBounds: custom }, symbol), custom);
  }
}
assert.equal(epcSymbols.find(s => s.type === 'event')?.shape, 'hexagon');
assert.ok(epcSymbols.find(s => s.type === 'function')?.appearance?.fill.includes('#00ab44'));
let source = epcNotation.addNode(epcNotation.createEmpty(), 'function', { x: 42, y: 71 });
const before = epcNotation.read(source).diagram.nodes[0];
source = epcNotation.rename(source, before.id, 'Сохранённое имя');
const after = epcNotation.read(source).diagram.nodes[0];
assert.deepEqual([after.id, after.x, after.y, after.width, after.height], [before.id, before.x, before.y, before.width, before.height]);
assert.equal(after.label, 'Сохранённое имя');
console.log('EPC: контраст всех цветов, границы текста и сохранность геометрии — OK');
