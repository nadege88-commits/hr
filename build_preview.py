"""Builds the single-file preview (logos, styles and script inlined) that is published as a Claude artifact."""
import base64, json, pathlib, sys

root = pathlib.Path(__file__).parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'preview.html'
logos = {p.stem: base64.b64encode(p.read_bytes()).decode() for p in sorted((root / 'logos').glob('*.png'))}
html = f'''<title>Northpoint Team</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap">
<style>
{(root / 'style.css').read_text()}
</style>
<div id="app"></div>
<script>window.NP_ARTIFACT = true; window.NP_LOGOS = {json.dumps(logos)};</script>
<script>
{(root / 'app.js').read_text()}
</script>
'''
out.write_text(html)
print(out, len(html))
