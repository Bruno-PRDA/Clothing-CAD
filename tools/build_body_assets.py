#!/usr/bin/env python3
"""Convert the MakeHuman CC0 base mesh and morph targets into the app's binary body assets.

The app ships a REAL human template mesh (MakeHuman's base mesh, 13 380 body vertices) plus the
morph targets that reshape it: gender/age, muscle/weight, height, and 20 measurement dimensions.
That is the same construction body-visualizer.com uses (it drives SMPL); MakeHuman's assets are
CC0, so unlike SMPL they need no registration and carry no non-commercial restriction.

Source:  https://github.com/makehumancommunity/makehuman  (assets: CC0 1.0, see LICENSE.ASSETS.md)

Usage:
    python tools/build_body_assets.py --tar  path/to/makehuman-master.tar.gz
    python tools/build_body_assets.py --dir  path/to/extracted/makehuman-master

Writes assets/body/{base.bin, targets.bin, index.json, LICENSE.md}.

Binary layout
-------------
base.bin     'MHBODY01' | u32 nVerts | u32 nTris | f32 toMetres
             | f32 positions[nVerts*3] | u32 indices[nTris*3]
targets.bin  per target, at the byte offset given in index.json:
             u16 vertexIndex[n] | i16 delta[n*3]        (delta in units, multiply by `scale`)

Vertices are remapped to the ones we actually use: the 13 380 body vertices (identity mapping) plus
the ~1 000 joint-cube vertices that give anatomical landmarks. MakeHuman's clothing/hair/eye helper
geometry is dropped, which removes ~30 % of every target.
"""
import argparse
import json
import os
import struct
import sys
import tarfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'assets', 'body')

N_BODY_VERTS = 13380          # base.obj group 'body' is vertices 0..13379, contiguous
TO_METRES = 0.1               # MakeHuman works in decimetres
I16_MAX = 32767

# Ages kept. MakeHuman ships baby/child/young/old; a clothing CAD never needs 'baby', and dropping
# it removes a quarter of the macro, muscle/weight and height target families.
KEEP_AGES = ('child', 'young', 'old')

LICENSE_TEXT = """# Body assets

`base.bin`, `targets.bin` and `index.json` are built from the **MakeHuman** base mesh and morph
targets by `tools/build_body_assets.py`.

- Upstream: <https://github.com/makehumancommunity/makehuman>
- Asset licence: **CC0 1.0 Universal** (public domain dedication). Every source `.target` file
  carries the line *"This asset was explicitly released as CC0 in september 2020."*; the full text
  is `LICENSE.ASSETS.md` in the upstream repository.
- Original mesh and targets copyright (C) 2014 Manuel Bastioni, released CC0 by the MakeHuman
  community in September 2020.

CC0 places no restriction on use, including commercial use, and requires no attribution — the
attribution above is given because it is the decent thing to do, not because it is required.

Note that MakeHuman's *program code* is AGPL. None of it is used here; only the CC0 assets are.

Contents
--------
| file | what |
|---|---|
| `base.bin` | template mesh: 14 380 vertices (13 380 body + joint landmark cubes), 26 756 triangles |
| `targets.bin` | 220 morph targets as quantised sparse vertex deltas |
| `index.json` | target directory, joint landmark vertex ranges, mesh metadata |
"""


def parse_obj(text):
    """-> (positions[list of (x,y,z)], quads[list of 4 indices], groups{name: [face indices]})."""
    positions, quads, groups, cur = [], [], {}, None
    for line in text.splitlines():
        if line.startswith('v '):
            p = line.split()
            positions.append((float(p[1]), float(p[2]), float(p[3])))
        elif line.startswith('g '):
            cur = line[2:].strip()
            groups.setdefault(cur, [])
        elif line.startswith('f '):
            idx = [int(tok.split('/')[0]) - 1 for tok in line.split()[1:]]
            groups[cur].append(len(quads))
            quads.append(idx)
    return positions, quads, groups


def wanted_target(rel):
    """rel is a path under data/targets/. Keep the macro/height/measure families we drive."""
    if rel.startswith('measure/'):
        return True
    if not rel.startswith('macrodetails/'):
        return False
    sub = rel[len('macrodetails/'):]
    if sub.startswith('proportions/'):
        return False                      # 'ideal vs uncommon proportions' is an aesthetic slider
    name = os.path.basename(sub)
    return any(f'-{a}-' in name or name.endswith(f'-{a}.target') for a in KEEP_AGES)


def target_name(rel):
    """macrodetails/height/male-young-...-maxheight.target -> 'height/male-young-...-maxheight'."""
    rel = rel[:-len('.target')] if rel.endswith('.target') else rel
    if rel.startswith('macrodetails/height/'):
        return 'height/' + os.path.basename(rel)
    if rel.startswith('macrodetails/'):
        return 'macro/' + os.path.basename(rel)
    if rel.startswith('measure/'):
        return 'measure/' + os.path.basename(rel)[len('measure-'):]
    return rel


def read_sources(args):
    """-> (obj_text, {relative target path: file text})."""
    targets = {}
    if args.tar:
        tf = tarfile.open(args.tar)
        obj = None
        for m in tf:
            if not m.isfile():
                continue
            p = m.name.split('/', 1)[1] if '/' in m.name else m.name
            if p.endswith('data/3dobjs/base.obj'):
                obj = tf.extractfile(m).read().decode('utf-8', 'replace')
            elif p.startswith('makehuman/data/targets/'):
                rel = p[len('makehuman/data/targets/'):]
                if wanted_target(rel):
                    targets[rel] = tf.extractfile(m).read().decode('utf-8', 'replace')
        return obj, targets

    base = args.dir
    obj_path = os.path.join(base, 'makehuman', 'data', '3dobjs', 'base.obj')
    obj = open(obj_path, encoding='utf-8', errors='replace').read()
    troot = os.path.join(base, 'makehuman', 'data', 'targets')
    for dirpath, _, files in os.walk(troot):
        for fn in files:
            if not fn.endswith('.target'):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), troot).replace('\\', '/')
            if wanted_target(rel):
                targets[rel] = open(os.path.join(dirpath, fn), encoding='utf-8', errors='replace').read()
    return obj, targets


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--tar', help='makehuman repository tar.gz')
    g.add_argument('--dir', help='extracted makehuman repository directory')
    args = ap.parse_args()

    print('reading sources...')
    obj_text, target_texts = read_sources(args)
    if obj_text is None:
        sys.exit('base.obj not found in the source')
    print(f'  base.obj + {len(target_texts)} targets')

    positions, quads, groups = parse_obj(obj_text)
    if len(positions) < N_BODY_VERTS:
        sys.exit(f'unexpected base.obj: {len(positions)} vertices')

    # --- vertex set: body (identity 0..13379) then the joint cubes, in ascending original order ---
    joint_groups = {k: v for k, v in groups.items() if k.startswith('joint-')}
    joint_verts = set()
    for faces in joint_groups.values():
        for f in faces:
            joint_verts.update(quads[f])
    joint_verts = sorted(v for v in joint_verts if v >= N_BODY_VERTS)
    remap = {v: v for v in range(N_BODY_VERTS)}
    for i, v in enumerate(joint_verts):
        remap[v] = N_BODY_VERTS + i
    n_verts = N_BODY_VERTS + len(joint_verts)
    print(f'  vertices: {N_BODY_VERTS} body + {len(joint_verts)} joint = {n_verts} '
          f'(dropped {len(positions) - n_verts} helper vertices)')

    # --- body triangles (quads are convex; split 0-1-2 / 0-2-3) ---
    tris = []
    for f in groups['body']:
        a, b, c, d = quads[f][:4]
        tris.append((a, b, c))
        tris.append((a, c, d))
    print(f'  triangles: {len(tris)}')

    # --- joint landmark ranges, in remapped indices ---
    joints = {}
    for name, faces in joint_groups.items():
        vs = sorted({remap[v] for f in faces for v in quads[f]})
        joints[name[len('joint-'):]] = [vs[0], vs[-1]]

    os.makedirs(OUT, exist_ok=True)

    # --- base.bin ---
    with open(os.path.join(OUT, 'base.bin'), 'wb') as fh:
        fh.write(b'MHBODY01')
        fh.write(struct.pack('<IIf', n_verts, len(tris), TO_METRES))
        pos = bytearray()
        inv = [0] * n_verts
        for orig, new in remap.items():
            inv[new] = orig
        for new in range(n_verts):
            x, y, z = positions[inv[new]]
            pos += struct.pack('<fff', x, y, z)
        fh.write(pos)
        idx = bytearray()
        for t in tris:
            idx += struct.pack('<III', *t)
        fh.write(idx)
    base_bytes = os.path.getsize(os.path.join(OUT, 'base.bin'))

    # --- targets.bin ---
    index = {}
    blob = bytearray()
    skipped_entries = 0
    for rel in sorted(target_texts):
        rows = []
        peak = 0.0
        for line in target_texts[rel].splitlines():
            if not line or line[0] == '#':
                continue
            f = line.split()
            if len(f) < 4:
                continue
            vi = int(f[0])
            new = remap.get(vi)
            if new is None:
                skipped_entries += 1
                continue                      # helper vertex we do not carry
            dx, dy, dz = float(f[1]), float(f[2]), float(f[3])
            if dx == 0.0 and dy == 0.0 and dz == 0.0:
                continue
            rows.append((new, dx, dy, dz))
            peak = max(peak, abs(dx), abs(dy), abs(dz))
        if not rows:
            continue
        rows.sort()
        scale = peak / I16_MAX if peak > 0 else 1.0
        if len(blob) % 2:
            blob += b'\0'                     # keep u16/i16 views aligned
        off = len(blob)
        blob += struct.pack(f'<{len(rows)}H', *[r[0] for r in rows])
        d = []
        for _, dx, dy, dz in rows:
            d += [max(-I16_MAX, min(I16_MAX, int(round(dx / scale)))),
                  max(-I16_MAX, min(I16_MAX, int(round(dy / scale)))),
                  max(-I16_MAX, min(I16_MAX, int(round(dz / scale))))]
        blob += struct.pack(f'<{len(d)}h', *d)
        index[target_name(rel)] = {'off': off, 'n': len(rows), 'scale': scale}
    with open(os.path.join(OUT, 'targets.bin'), 'wb') as fh:
        fh.write(blob)

    ys = [positions[v][1] for v in range(N_BODY_VERTS)]
    meta = {
        'source': 'MakeHuman (CC0) — github.com/makehumancommunity/makehuman',
        'units': 'decimetre',
        'toMetres': TO_METRES,
        'nVerts': n_verts,
        'nBodyVerts': N_BODY_VERTS,
        'nTris': len(tris),
        'restHeight_m': round((max(ys) - min(ys)) * TO_METRES, 6),
        'restFootY': round(min(ys), 6),
        'joints': joints,
        'targets': index,
    }
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, separators=(',', ':'), sort_keys=True)
    with open(os.path.join(OUT, 'LICENSE.md'), 'w', encoding='utf-8') as fh:
        fh.write(LICENSE_TEXT)

    print(f'\nwrote {OUT}')
    print(f'  base.bin     {base_bytes/1048576:6.2f} MB   {n_verts} verts, {len(tris)} tris')
    print(f'  targets.bin  {len(blob)/1048576:6.2f} MB   {len(index)} targets, '
          f'{sum(t["n"] for t in index.values()):,} entries '
          f'({skipped_entries:,} helper entries dropped)')
    print(f'  rest height  {meta["restHeight_m"]:.4f} m')


if __name__ == '__main__':
    main()
