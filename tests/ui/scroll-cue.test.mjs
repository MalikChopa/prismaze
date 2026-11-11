// V12 (audit G5, C3) : indice de défilement d'un panneau (data-more).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMoreBelow, watchScroll } from '../../src/ui/scroll-cue.js';

test('V12 : hasMoreBelow (tolérance 2 px)', () => {
  assert.equal(hasMoreBelow(672, 296, 0), true);
  assert.equal(hasMoreBelow(672, 296, 376), false);
  assert.equal(hasMoreBelow(300, 298, 0), false);
  assert.equal(hasMoreBelow(301, 298, 0), true);
});

test('V12 : watchScroll pose et retire data-more au défilement ; sans élément ou faux document : rien', () => {
  const handlers = {};
  const el = { scrollHeight: 600, clientHeight: 300, scrollTop: 0, dataset: {}, children: [], addEventListener: (t, fn) => { handlers[t] = fn; }, removeEventListener: (t) => { delete handlers[t]; } };
  const w = watchScroll(el);
  assert.equal(el.dataset.more, '1');
  el.scrollTop = 300; handlers.scroll();
  assert.equal(el.dataset.more, undefined);
  el.scrollTop = 100; w.update();
  assert.equal(el.dataset.more, '1');
  w.destroy();
  assert.equal(handlers.scroll, undefined);
  assert.doesNotThrow(() => watchScroll(null).update());
  assert.doesNotThrow(() => watchScroll({}).update());
});
