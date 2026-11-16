#!/usr/bin/env python3
"""Generate offline help from the checked-in localized READMEs."""
import html, re
from pathlib import Path

def inline(s):
    s = html.escape(s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\[([^]]+)\]\((https?://[^)]+)\)', r'<a href="\2">\1</a>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    return s

for language in ('en', 'zh-Hant', 'ja'):
    source = Path('README.md' if language == 'en' else f'README.{language}.md')
    lines = source.read_text().splitlines()
    output = []
    code = False
    for line in lines:
        if line.startswith('```'):
            output.append('</code></pre>' if code else '<pre><code>'); code = not code; continue
        if code: output.append(html.escape(line)); continue
        if re.fullmatch(r'\|[ :|\-]+\|', line): continue
        if line.startswith('|'):
            cells = line.strip('|').split('|')
            output.append('<p>' + ' — '.join(inline(c.strip()) for c in cells) + '</p>'); continue
        if not line: continue
        if line.startswith('#'):
            n = len(line)-len(line.lstrip('#')); output.append(f'<h{n}>' + inline(line[n:].strip()) + f'</h{n}>'); continue
        if line.startswith('- '): output.append('<p>• ' + inline(line[2:]) + '</p>'); continue
        if line.startswith('[English]') or line.startswith('English ·'): continue
        output.append('<p>' + inline(line) + '</p>')
    doc = f'''<!doctype html><html lang="{language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Inkflit</title><style>html{{color-scheme:light dark}}body{{font:15px/1.7 -apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 24px}}code,pre{{font-family:ui-monospace,monospace}}pre{{padding:16px;border-radius:8px;background:color-mix(in srgb,CanvasText 7%,Canvas);overflow:auto}}a{{color:#c56926}}</style><body>{''.join(output)}</body></html>'''
    Path(f'Resources/Help.{language}.html').write_text(doc)
