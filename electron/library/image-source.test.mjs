import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveImageSource } from '../../src/images/imageSource.ts';
test('local images use the streaming protocol with safe path encoding', () => {
  assert.equal(resolveImageSource('C:\\游戏\\封面 #1.png'), 'local-file://localhost/C%3A/%E6%B8%B8%E6%88%8F/%E5%B0%81%E9%9D%A2%20%231.png');
  assert.equal(resolveImageSource('E:\\other\\a.jpg'), 'local-file://localhost/E%3A/other/a.jpg');
  for (const source of ['', 'https://example.com/a.png', 'data:image/png;base64,abc', 'local-file:///C%3A/a.png']) assert.equal(resolveImageSource(source), source);
});
