#!/usr/bin/env python3
"""Build the offline help page, Resources/Help.html, from help/.

help/template.html      page layout, styles and script
help/<language>.html    one file per language: a JSON label block and <section>s
help/shortcuts.json     the shortcut table, rendered into every language

All languages go into one self-contained page as <template data-lang> blocks;
the app opens it with ?lang=<language>. Run from the repository root.
"""
import html
import json
import re
from base64 import b64encode
from pathlib import Path
from struct import unpack_from

LANGUAGES = ['en', 'zh-Hans', 'zh-Hant', 'ja']
root = Path('help')
version = json.loads(Path('package.json').read_text())['version']


def keys(row):
    # "⌘1", "⌘9" with range: ⌘1–⌘9; otherwise alternatives: ⌘[ / ⌘]
    combos = [f'<kbd>{html.escape(key)}</kbd>' for key in row['keys']]
    return '–'.join(combos) if row.get('range') else ' / '.join(combos)


def shortcut_table(language, data):
    head = ''.join(f'<th>{html.escape(cell)}</th>' for cell in data['header'][language])
    body = []
    for group in data['groups']:
        body.append(f'<tr class="group"><td colspan="2">{html.escape(group["title"][language])}</td></tr>')
        body += [f'<tr><td>{keys(row)}</td><td>{html.escape(row[language])}</td></tr>' for row in group['rows']]
    return f'<table><thead><tr>{head}</tr></thead><tbody>{"".join(body)}</tbody></table>'


def section_ids(text):
    return re.findall(r'<section id="([^"]+)"', text)


def app_icon_url():
    """Embed the app icon at twice the 64 pt title size when available."""
    icon = Path('Resources/Inkflit.icns').read_bytes()
    signature, length = unpack_from('>4sI', icon)
    if signature != b'icns' or length != len(icon):
        raise ValueError('Invalid Inkflit.icns header')
    offset = 8
    images = {}
    while offset + 8 <= length:
        _, size = unpack_from('>4sI', icon, offset)
        if size < 8 or offset + size > length:
            raise ValueError('Invalid Inkflit.icns image size')
        png = icon[offset + 8:offset + size]
        if len(png) >= 24 and png.startswith(b'\x89PNG\r\n\x1a\n') and png[12:16] == b'IHDR':
            width, height = unpack_from('>II', png, 16)
            if width == height:
                images[width] = png
        offset += size
    if not images:
        raise ValueError('No PNG representation in Inkflit.icns')
    width = min(images, key=lambda size: (size < 128, abs(size - 128)))
    return 'data:image/png;base64,' + b64encode(images[width]).decode('ascii')


shortcuts = json.loads((root / 'shortcuts.json').read_text())
expected = None
blocks = []
for language in LANGUAGES:
    text = (root / f'{language}.html').read_text()
    labels = json.loads(re.search(r'<script type="application/json">(.*?)</script>', text, re.S).group(1))
    assert set(labels) == {'title', 'tagline', 'label', 'search', 'empty'}, f'{language}: label keys'
    ids = section_ids(text)
    expected = expected or ids
    assert ids == expected, f'{language}: sections {ids} differ from {expected}'
    assert text.count('%SHORTCUTS%') == 1, f'{language}: needs one %SHORTCUTS% placeholder'
    text = text.replace('%SHORTCUTS%', shortcut_table(language, shortcuts))
    blocks.append(f'<template data-lang="{language}">\n{text.strip()}\n</template>')

page = (root / 'template.html').read_text()
page = page.replace('%APP_VERSION%', version).replace('%APP_ICON%', app_icon_url()).replace('%LANGUAGES%', '\n'.join(blocks))
for placeholder in ('%APP_VERSION%', '%APP_ICON%', '%LANGUAGES%', '%SHORTCUTS%'):
    assert placeholder not in page, f'unfilled {placeholder}'
Path('Resources/Help.html').write_text(page)
