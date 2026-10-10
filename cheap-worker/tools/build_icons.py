"""Rebuild the provider icons: auto grids from assets/providers/*.png, hand-drawn overrides
from tools/handmade.py, and one SVG per grid for the remote surfaces.
Run: python3 tools/build_icons.py   (from the mod folder)"""
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'assets')
subprocess.run([sys.executable, os.path.join(here, 'grid.py'), A], check=True)
sys.path.insert(0, here)
from handmade import grids
px = json.load(open(f'{A}/providers-px.json')); px.update(grids())
json.dump(px, open(f'{A}/providers-px.json', 'w'), separators=(',', ':'))
os.makedirs(f'{A}/providers-svg', exist_ok=True)
for name, g in grids().items():  # hand-drawn ones get crisp 8x8 SVGs; the rest keep their 16x16 traces
    rects = []
    for y, row in enumerate(g):
        x = 0
        while x < 8:
            c = row[x]
            if c is None: x += 1; continue
            x0 = x
            while x < 8 and row[x] == c: x += 1
            rects.append(f'<rect x="{x0}" y="{y}" width="{x - x0}" height="1" fill="{c}"/>')
    open(f'{A}/providers-svg/{name}.svg', 'w').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">{"".join(rects)}</svg>')
print(len(px), 'grids;', len(grids()), 'hand-drawn')
