import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const languages = ['en', 'zh-Hans', 'zh-Hant', 'ja'];
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sectionIds = text => [...text.matchAll(/<section id="([^"]+)"/g)].map(match => match[1]);
const labelsOf = text => JSON.parse(text.match(/<script type="application\/json">(.*?)<\/script>/s)[1]);

test('every help language has the same sections and labels', async () => {
  const english = await read('help/en.html');
  const ids = sectionIds(english);
  assert.ok(ids.length >= 10);
  for (const language of languages) {
    const text = await read(`help/${language}.html`);
    assert.deepEqual(sectionIds(text), ids, `${language}: sections`);
    assert.deepEqual(Object.keys(labelsOf(text)).sort(), ['empty', 'label', 'search', 'tagline', 'title'], `${language}: labels`);
    assert.equal(text.split('%SHORTCUTS%').length, 2, `${language}: one shortcut table`);
    for (const id of ids) assert.match(text, new RegExp(`<section id="${id}">\\s*<h2>[^<]+</h2>`), `${language}: ${id} heading`);
  }
});

test('every shortcut row is described in every language', async () => {
  const shortcuts = JSON.parse(await read('help/shortcuts.json'));
  for (const language of languages) assert.equal(shortcuts.header[language].length, 2);
  for (const group of shortcuts.groups) {
    for (const language of languages) assert.ok(group.title[language], `group title ${language}`);
    for (const row of group.rows) {
      assert.ok(row.keys.length >= 1);
      for (const language of languages) assert.ok(row[language]?.trim(), `${row.keys.join(' ')}: ${language}`);
    }
  }
});

test('the generated help page carries every language and the current version', async () => {
  const page = await read('Resources/Help.html');
  const { version } = JSON.parse(await read('package.json'));
  for (const language of languages) {
    assert.match(page, new RegExp(`<template data-lang="${language}">`));
    assert.ok(page.includes(labelsOf(await read(`help/${language}.html`)).title), `${language}: rebuild Resources/Help.html with scripts/build-help.py`);
  }
  assert.ok(page.includes(` · ${version}<`), 'version from package.json');
  assert.doesNotMatch(page, /%(APP_VERSION|LANGUAGES|SHORTCUTS)%/);
});
