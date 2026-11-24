import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { app } from '../web/app.js';
import { availableCommands } from '../web/commands.js';
import { filterCommands } from '../web/command-palette.js';
import { lang, setLanguage, t } from '../web/i18n.js';

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
    assert.equal(text.split('%COMMAND_KEYWORDS%').length, 2, `${language}: one command keyword table`);
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

test('every palette command has a searchable keyword in every help language', async () => {
  const { groups } = JSON.parse(await read('help/commands.json'));
  const rows = groups.flatMap(group => group.rows);
  const original = { language: lang(), windowPinMode: app.windowPinMode, vimEnabled: app.vimEnabled };
  try {
    for (const language of languages) {
      setLanguage(language);
      const labels = new Map(rows.map(row => [row.id, new Set()]));
      for (const [pinMode, enabled] of [['off', false], ['keepOpen', true], ['alwaysOnTop', true]]) {
        app.windowPinMode = pinMode;
        app.vimEnabled = enabled;
        const commands = availableCommands({ includeUnavailable: true });
        assert.deepEqual(rows.map(row => row.id).sort(), commands.map(command => command.id).sort());
        for (const { id, keyword } of rows) {
          const matches = filterCommands(commands, keyword);
          assert.deepEqual(matches.map(command => command.id), [id], `${language}: ${keyword}`);
          labels.get(id).add(matches[0].label);
        }
      }
      for (const row of rows) {
        assert.deepEqual(labels.get(row.id), new Set(row.labels.map(t)), `${language}: labels for ${row.id}`);
      }
    }
  } finally {
    setLanguage(original.language);
    app.windowPinMode = original.windowPinMode;
    app.vimEnabled = original.vimEnabled;
  }
});

test('the generated help page carries every language and the current version', async () => {
  const page = await read('Resources/Help.html');
  const { version } = JSON.parse(await read('package.json'));
  const { groups } = JSON.parse(await read('help/commands.json'));
  const commands = groups.flatMap(group => group.rows.map(row => row.id));
  for (const language of languages) {
    const template = page.split(`<template data-lang="${language}">`)[1]?.split('</template>')[0];
    assert.ok(template, `${language}: help template`);
    assert.deepEqual([...template.matchAll(/data-command="([^"]+)"/g)].map(match => match[1]), commands);
    assert.ok(page.includes(labelsOf(await read(`help/${language}.html`)).title), `${language}: rebuild Resources/Help.html with scripts/build-help.py`);
  }
  assert.ok(page.includes(` · ${version}<`), 'version from package.json');
  assert.doesNotMatch(page, /%(APP_VERSION|APP_ICON|UI_THEME_STYLES|LANGUAGES|SHORTCUTS|COMMAND_KEYWORDS)%/);
});

test('offline help embeds every editor palette in both appearances', async () => {
  const page = await read('Resources/Help.html');
  const themes = JSON.parse(await read('Resources/UIThemes.json'));
  for (const [index, theme] of themes.entries()) {
    const selector = index === 0 ? ':root' : `:root[data-ui-theme="${theme.id}"]`;
    for (const [suffix, colors] of [['', theme.colors], ['[data-color-scheme="dark"]', theme.darkColors]]) {
      const name = `${selector}${suffix}`;
      const rules = page.split(`${name} { `).slice(1).map(rule => rule.split('}')[0]);
      assert.ok(rules.some(rule => Object.entries(colors).every(([key, value]) => rule.includes(`--ui-${key}: ${value};`))),
        `missing or stale palette ${name}`);
    }
  }
});
