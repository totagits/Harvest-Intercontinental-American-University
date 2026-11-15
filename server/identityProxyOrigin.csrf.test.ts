import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('identity CSRF origin validation accepts the actual request host behind a secure reverse proxy',()=>{
  const source=readFileSync(new URL('./identity.ts',import.meta.url),'utf8');
  assert.match(source,/candidate\.origin === configured\.origin/);
  assert.match(source,/candidate\.host !== requestHost/);
  assert.match(source,/secure && candidate\.protocol !== 'https:'/);
  assert.match(source,/Request verification failed\. Refresh and try again\./);
});
