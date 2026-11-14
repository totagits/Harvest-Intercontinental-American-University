import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Finance assistance credit panel uses HIAU palette and readable action text',()=>{
  const ui=readFileSync(new URL('../src/components/portal/StudentAssistanceRequests.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/index.css',import.meta.url),'utf8');

  assert.match(ui,/hiau-finance-assistance-credit/);
  assert.match(ui,/hiau-finance-primary/);
  assert.doesNotMatch(ui,/border-emerald-200 bg-emerald-50/);

  assert.match(css,/\.hiau-finance-assistance-credit/);
  assert.match(css,/background-color: #faf7fb !important/);
  assert.match(css,/border: 1px solid #d8c8dc !important/);
  assert.match(css,/\.hiau-finance-primary/);
  assert.match(css,/color: #ffffff !important/);
  assert.match(css,/-webkit-text-fill-color: #ffffff !important/);
});
