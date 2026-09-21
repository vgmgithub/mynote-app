import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { applyIcons, usesStagingIcons, stagingPaths, STAGING_MANIFEST } from '../../env-icons.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const json = (f) => JSON.parse(read(f).replace(/^﻿/, ''));

// A stand-in page: three link elements whose href we can read back.
function fakeDoc() {
  const links = {
    'link[rel="manifest"]': { href: 'manifest.webmanifest', setAttribute(k, v) { this.href = v; } },
    'link[rel="icon"]': { href: 'icons/icon-192.png', setAttribute(k, v) { this.href = v; } },
    'link[rel="apple-touch-icon"]': { href: 'icons/icon-180.png', setAttribute(k, v) { this.href = v; } },
  };
  return { links, querySelector: (s) => links[s] || null };
}

test('production keeps the existing icons: nothing on the page is touched', () => {
  const d = fakeDoc();
  assert.equal(applyIcons(d, 'production'), false);
  assert.equal(d.links['link[rel="manifest"]'].href, 'manifest.webmanifest');
  assert.equal(d.links['link[rel="icon"]'].href, 'icons/icon-192.png');
  assert.equal(d.links['link[rel="apple-touch-icon"]'].href, 'icons/icon-180.png');
});

test('staging and local get the yellow icons', () => {
  for (const env of ['staging', 'local']) {
    const d = fakeDoc();
    assert.equal(applyIcons(d, env), true, env);
    assert.equal(d.links['link[rel="manifest"]'].href, STAGING_MANIFEST);
    assert.equal(d.links['link[rel="icon"]'].href, 'icons/staging/icon-192.png');
    assert.equal(d.links['link[rel="apple-touch-icon"]'].href, 'icons/staging/icon-180.png');
  }
  assert.equal(usesStagingIcons('production'), false);
  assert.equal(usesStagingIcons('staging'), true);
  assert.equal(applyIcons(null, 'staging'), false, 'no page, no error');
});

test('the page itself still points at the production files, so production is unchanged even if this script never runs', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.match(html, /<link rel="icon" href="icons\/icon-192\.png" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="icons\/icon-180\.png" \/>/);
  assert.match(html, /<script type="module" src="env-icons\.js"><\/script>/);
});

test('the production manifest still names exactly the existing icons', () => {
  assert.deepEqual(json('manifest.webmanifest').icons.map((i) => i.src),
    ['icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']);
});

test('the staging manifest is the production manifest with only the icon paths changed', () => {
  const prod = json('manifest.webmanifest');
  const stg = json(STAGING_MANIFEST);
  const strip = (m) => ({ ...m, icons: undefined });
  assert.deepEqual(strip(stg), strip(prod), 'every other field must match, so staging behaves like production');
  assert.deepEqual(stg.icons.map((i) => i.src.replace('icons/staging/', 'icons/')), prod.icons.map((i) => i.src));
  assert.deepEqual(stg.icons.map((i) => [i.sizes, i.purpose, i.type]), prod.icons.map((i) => [i.sizes, i.purpose, i.type]));
});

test('every staging icon exists and is the size the manifest claims', () => {
  const stg = json(STAGING_MANIFEST);
  for (const i of stg.icons) {
    assert.ok(existsSync(new URL('../../' + i.src, import.meta.url)), i.src + ' is missing');
    const png = readFileSync(new URL('../../' + i.src, import.meta.url));
    assert.equal(png.readUInt32BE(16), Number(i.sizes.split('x')[0]), i.src + ' has the wrong width');
    assert.equal(png.readUInt32BE(20), Number(i.sizes.split('x')[1]), i.src + ' has the wrong height');
  }
  const p = stagingPaths();
  assert.ok(existsSync(new URL('../../' + p.favicon, import.meta.url)));
  assert.ok(existsSync(new URL('../../' + p.apple, import.meta.url)));
});

test('the offline cache lists the script that the page loads', () => {
  assert.match(read('service-worker.js'), /\.\/env-icons\.js/);
});
