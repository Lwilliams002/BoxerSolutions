import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNorthFieldsHostPage } from '../src/content/northFieldsHostPage';

test('host page exposes the mount/submit bridge and posts host-ready', () => {
  const html = renderNorthFieldsHostPage('https://checkout.north.com/checkout.js');
  assert.match(html, /window\.__sfMount = function \(sessionToken\)/);
  assert.match(html, /window\.__sfSubmit = function \(\)/);
  assert.match(html, /send\(\{ type: 'host-ready' \}\)/);
  assert.match(html, /id="fields-root"/);
  assert.ok(html.includes('"https://checkout.north.com/checkout.js"'));
});

test('host page carries no session token and escapes script-breaking characters', () => {
  const html = renderNorthFieldsHostPage('https://x.test/a.js?q=</script><b>');
  assert.equal(html.includes('</script><b>'), false);
  assert.ok(html.includes('\\u003c/script>\\u003cb>'));
  assert.equal(/sessionToken\s*=\s*"/.test(html), false);
});

test('inline script is valid JavaScript', () => {
  const html = renderNorthFieldsHostPage('https://checkout.north.com/checkout.js');
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match);
  assert.doesNotThrow(() => new Function(match![1]));
});
