import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { compile } from '../src/compiler.js';
import { loadGenerated } from '../test/helpers.js';

const source = readFileSync(new URL('./todo.jsx', import.meta.url), 'utf8');
const { code, initialHtml, signalToMarkers, declName } = compile(source);

console.log('--- dependency graph: root signal -> markers it must update ---');
for (const [declId, markerIds] of signalToMarkers) {
  console.log(`  ${declName.get(declId)} -> [${[...markerIds].join(', ')}]`);
}

console.log('\n--- generated code ---');
console.log(code);

console.log('\n--- initial HTML (baked at compile time) ---');
console.log(initialHtml);

const mod = await loadGenerated(code);
const dom = new JSDOM('<!doctype html><div id="app"></div>');
const container = dom.window.document.getElementById('app');
mod.mountComponent(container);

console.log('\n--- mounted into a real DOM ---');
console.log(container.innerHTML);

console.log('\n--- remove "Buy milk" (one update_items() call touches the <h1> count AND the <ul>) ---');
mod.items(mod.items().filter((item) => item.id !== 1));
mod.update_items();
console.log(container.innerHTML);

console.log('\n--- clear the list entirely (the empty-state conditional should now appear) ---');
mod.items([]);
mod.update_items();
console.log(container.innerHTML);

console.log('\n--- add an item back (conditional disappears, list re-populates) ---');
mod.items([{ id: 3, name: 'Water the plants' }]);
mod.update_items();
console.log(container.innerHTML);
