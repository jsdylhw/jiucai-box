"""Create a local, offline HTML artifact without server or external dependencies."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
dist = ROOT / 'dist'
html = (dist / 'index.html').read_text(encoding='utf-8')
css = (dist / 'style.css').read_text(encoding='utf-8')
modules = '\n'.join((dist / name).read_text(encoding='utf-8').replace('export ', '')
                    for name in ['engine.mjs', 'scenarios.mjs', 'indicators.mjs', 'inspection.mjs'])
app = (dist / 'app.mjs').read_text(encoding='utf-8')
app = re.sub(r'^import .*\n', '', app, flags=re.MULTILINE)
payload = (dist / 'data' / 'us-2025.json').read_text(encoding='utf-8')
app, count = re.subn(r"const response=await fetch\('./data/us-2025.json'\);.*?source=await response.json\(\);", 'source = embeddedData;', app)
assert count == 1
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
script = f'const embeddedData = {payload};\n{modules}\n{app}'
html = html.replace('<script type="module" src="app.mjs"></script>', '<script type="module">' + script.replace('</script', '<\\/script') + '</script>')
output = ROOT / 'jiucai-box.html'
output.write_text(html, encoding='utf-8')
print(json.dumps({'file': str(output), 'bytes': output.stat().st_size}))
