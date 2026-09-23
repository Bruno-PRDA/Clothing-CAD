# Body assets

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
| `targets.bin` | morph targets as quantised sparse vertex deltas: macro, height, measure and the detail families |
| `index.json` | target directory, joint landmark vertex ranges, mesh metadata |
