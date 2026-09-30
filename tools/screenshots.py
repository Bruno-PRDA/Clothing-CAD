#!/usr/bin/env python3
"""Regenerate the README showcase images in docs/images/ by driving the app in headless Chromium.

    python tools/screenshots.py                 # every shot
    python tools/screenshots.py hero bodies     # only these (names below)
    python tools/screenshots.py --list

Needs:  python -m pip install playwright pillow  &&  python -m playwright install chromium

Every scene is staged through the window.__app automation API (SPEC section 12) and every drape is stepped
synchronously for a fixed number of frames, so a rerun gives the same pictures. Pages are rendered at twice
the size and scaled down, which anti-aliases the 3D view.
"""

from __future__ import annotations

import argparse
import base64
import io
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests' / 'ci'))
from run_browser_tests import CHROMIUM_ARGS, GPU_ARGS, free_port, start_server  # noqa: E402

OUT = ROOT / 'docs' / 'images'
VIEWPORT = {'width': 1600, 'height': 900}
SCALE = 2          # device pixels per CSS pixel while rendering; images are scaled back down by this
DRAPE_FRAMES = 600  # 10 s of simulated time: sewn, dropped and settled

# In-page helpers. Everything goes through window.__app except the camera, which the API only frames.
HELPERS = r"""
window.__shot = {
  async frames(n = 3) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); },

  /** Load a sample, dress it and drape it for `frames` frames with the animation loop paused. */
  async drape(o = {}) {
    const a = window.__app;
    a.loadSample(o.sample || 'tshirt'); await a.idle(); a.sim.pause();
    if (o.body) { a.body.setPreset(o.body); await a.idle(); }
    if (o.size) { a.sizes.setActive(o.size === 'closest' ? a.sizes.closest().name : o.size); await a.idle(); }
    const fid = a.doc().fabrics[0].id;
    if (o.fabric) { a.fabric.setPreset(fid, o.fabric); await a.idle(); }
    if (o.color) { a.fabric.setColor(fid, o.color); await a.idle(); }
    if (o.texture) { a.fabric.setTexture(fid, o.texture[0], o.texture[1] || {}); await a.idle(); }
    a.viewer.scene(o.scene || 'studio', null);
    a.ui.layout(o.layout || '3d'); a.ui.dock(o.dock || 'pieces'); await a.idle();
    a.viewer.resize();
    this.spreadPieces(); await a.idle();
    this.showTears = !!o.tears;
    a.sim.pause(); a.sim.reset();
    const st = o.frames === 0 ? null : a.sim.step(o.frames || 600);
    a.sim.pause();
    await this.frames(4);
    return st;
  },

  /**
   * The over-stretch markers are a diagnostic overlay that the frame loop refreshes; only the fit shot is about
   * them, so the others filter them out at the one place they enter the viewer.
   */
  hideTearsUnlessAsked() {
    const tears = window.__app.ctx.mods.viewer.tears;
    const setMarks = tears.setMarks;
    tears.setMarks = (marks) => setMarks(this.showTears ? marks : null);
  },

  /**
   * The samples store every piece about x = 0, drawn on top of each other. Fold pieces must keep their fold on
   * x = 0, so they are stacked downwards; the other pieces go in a column to their right, one per row.
   */
  spreadPieces(gap = 80) {
    const a = window.__app;
    const doc = a.doc();
    const boxes = [];
    for (const piece of doc.pieces) {
      const m = a.mesh.get(piece.id);
      if (!m) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < m.positions2d.length; i += 2) {
        x0 = Math.min(x0, m.positions2d[i]); x1 = Math.max(x1, m.positions2d[i]);
        y0 = Math.min(y0, m.positions2d[i + 1]); y1 = Math.max(y1, m.positions2d[i + 1]);
      }
      boxes.push({ id: piece.id, fold: piece.foldEdge !== null, x0, x1, y0, y1 });
    }
    const folds = boxes.filter((b) => b.fold);
    const others = boxes.filter((b) => !b.fold);
    const right = Math.max(0, ...folds.map((b) => b.x1)) + gap;
    let top = Math.max(...boxes.map((b) => b.y1));
    const rowTops = [];
    for (const b of folds) {
      rowTops.push(top);
      a.pattern.movePiece(b.id, 0, top - b.y1);
      top -= (b.y1 - b.y0) + gap;
    }
    others.forEach((b, i) => {
      const rowTop = i < rowTops.length ? rowTops[i] : top - (i - rowTops.length) * ((b.y1 - b.y0) + gap);
      a.pattern.movePiece(b.id, right - b.x0, rowTop - b.y1);
    });
  },

  /** Let the frame-rate readout settle after the synchronous drape blocked the loop. */
  async settle(ms = 1500) { await new Promise((r) => setTimeout(r, ms)); await this.frames(2); },

  /** Aim the camera at the vertical band [y0, y1] (metres) from an azimuth (deg, 0 = front, + = model's left). */
  frameBand(y0, y1, azimuthDeg = 25, elevDeg = 6, margin = 1.12) {
    const v = window.__app.ctx.mods.viewer.viewer;
    const cam = v.camera;
    const h = (y1 - y0) * margin;
    const dist = (h / 2) / Math.tan((cam.fov * Math.PI / 180) / 2);
    const az = azimuthDeg * Math.PI / 180, el = elevDeg * Math.PI / 180;
    const ty = (y0 + y1) / 2;
    cam.position.set(Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    v.controls.target.set(0, ty, 0);
    v.controls.update();
  },

  landmarkY(name) { const p = window.__app.body.landmark(name); return Array.isArray(p) ? p[1] : p.y; },

  async canvasPng() { await this.frames(3); return window.__app.viewer.screenshotDataUrl(); },
};
"""


def png_from_data_url(url: str):
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGB')


def page_image(page, **kw):
    from PIL import Image
    return Image.open(io.BytesIO(page.screenshot(**kw))).convert('RGB')


def shrink(img, factor: float = 1 / SCALE):
    from PIL import Image
    return img.resize((round(img.width * factor), round(img.height * factor)), Image.LANCZOS)


def center_crop(img, w: int, h: int):
    x = (img.width - w) // 2
    y = (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def strip(images, gap: int = 0, bg=(255, 255, 255)):
    from PIL import Image
    w = sum(i.width for i in images) + gap * (len(images) - 1)
    h = max(i.height for i in images)
    out = Image.new('RGB', (w, h), bg)
    x = 0
    for i in images:
        out.paste(i, (x, 0))
        x += i.width + gap
    return out


def trim(img, pad: int = 24, bg=(255, 255, 255)):
    """Crop to the non-background content plus `pad` pixels."""
    from PIL import Image, ImageChops
    box = ImageChops.difference(img, Image.new('RGB', img.size, bg)).getbbox()
    if not box:
        return img
    x0, y0, x1, y1 = box
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))


def without_statusbar(img):
    """The status bar's frame rate reads 0-1 fps while the solver is paused or the 3D view hidden; leave it out."""
    return img.crop((0, 0, img.width, img.height - 24))


def save(img, name: str, quality: int = 88) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    if name.endswith('.jpg'):
        img.save(path, quality=quality, optimize=True, progressive=True)
    else:
        img.save(path, optimize=True)
    print(f'  wrote {path.relative_to(ROOT)}  {img.width}x{img.height}  {path.stat().st_size // 1024} kB', flush=True)


def torso(page, azimuth: float = 25) -> None:
    page.evaluate(f"""() => {{ const s = window.__shot;
        s.frameBand(s.landmarkY('hipCenter') - 0.12, s.landmarkY('headTop') + 0.02, {azimuth}, 4); }}""")


def full_body(page, azimuth: float = 20) -> None:
    page.evaluate(f"""() => {{ const s = window.__shot;
        s.frameBand(0, s.landmarkY('headTop'), {azimuth}, 3, 1.08); }}""")


# ------------------------------------------------------------------ shots

def shot_hero(page) -> None:
    """The whole app: pattern on the left, the draped shirt on the right."""
    page.evaluate("() => window.__shot.drape({ layout: 'split', scene: 'studio', dock: 'body', size: 'L' })")
    torso(page)
    page.evaluate("() => { window.__app.pattern.fit(); return window.__shot.settle(); }")
    save(without_statusbar(shrink(page_image(page))), 'hero.jpg')


def shot_editor(page) -> None:
    """The 2D pattern editor with a seam selected (its ease readout in the dock)."""
    page.evaluate("() => window.__shot.drape({ layout: '2d', frames: 0, dock: 'pieces' })")
    page.evaluate("""async () => { const a = window.__app;
        a.pattern.select('front'); a.pattern.fit(); await window.__shot.frames(4); }""")
    save(without_statusbar(shrink(page_image(page))), 'editor.png')


def shot_fabrics(page) -> None:
    """One shirt, four fabrics: the same pattern drapes and renders differently."""
    looks = [
        {'fabric': 'cotton', 'color': '#c8102e'},
        {'fabric': 'denim', 'color': '#3d5a80', 'texture': ['twill', {'color2': '#22344d', 'scale_mm': 4}]},
        {'fabric': 'silk', 'color': '#e9d8c4'},
        {'fabric': 'jersey', 'color': '#1d2b4f', 'texture': ['stripes', {'color2': '#f4f1ea', 'scale_mm': 22}]},
    ]
    tiles = []
    for look in looks:
        page.evaluate("(o) => window.__shot.drape(o)", {**look, 'scene': 'studio', 'size': 'L'})
        torso(page, 28)
        img = png_from_data_url(page.evaluate('() => window.__shot.canvasPng()'))
        tiles.append(shrink(center_crop(img, round(img.height * 0.62), img.height)))
    save(strip(tiles, gap=4), 'fabrics.jpg')


def shot_bodies(page) -> None:
    """The same design on four bodies, each wearing its closest size of the chart (S, M, L, XL)."""
    tiles = []
    for body in ('female_s', 'female_m', 'female_l', 'plus_f'):
        page.evaluate("(o) => window.__shot.drape(o)", {'body': body, 'size': 'closest', 'scene': 'studio',
                                                        'color': '#2f6f73'})
        full_body(page)
        img = png_from_data_url(page.evaluate('() => window.__shot.canvasPng()'))
        tiles.append(shrink(center_crop(img, round(img.height * 0.46), img.height)))
    save(strip(tiles, gap=4), 'bodies.jpg')


def shot_skirt(page) -> None:
    """The A-line skirt in a gingham wool, waist to calf."""
    page.evaluate("(o) => window.__shot.drape(o)", {'sample': 'skirt', 'scene': 'pedestal', 'fabric': 'wool',
                                                    'color': '#7a2e3a', 'texture': ['gingham', {'color2': '#e8dcc8', 'scale_mm': 18}]})
    page.evaluate("""() => { const s = window.__shot;
        s.frameBand(s.landmarkY('kneeL') - 0.22, s.landmarkY('waistCenter') + 0.06, 30, 10, 1.06); }""")
    img = png_from_data_url(page.evaluate('() => window.__shot.canvasPng()'))
    save(shrink(center_crop(img, round(img.height * 0.9), img.height)), 'skirt.jpg')


def shot_dress(page) -> None:
    """The fitted dress: bust and waist darts, a waist seam, a centre-back zip."""
    page.evaluate("(o) => window.__shot.drape(o)", {'sample': 'dress', 'scene': 'studio'})
    full_body(page, 25)
    img = png_from_data_url(page.evaluate('() => window.__shot.canvasPng()'))
    save(shrink(center_crop(img, round(img.height * 0.72), img.height)), 'dress.jpg')


def shot_fit(page) -> None:
    """A size too small for the body: the banner and the markers where the cloth over-stretches."""
    page.evaluate("(o) => window.__shot.drape(o)", {'body': 'plus_f', 'size': 'S', 'scene': 'dark', 'layout': '3d',
                                                    'dock': 'sizes', 'color': '#d9d4c7', 'tears': True})
    torso(page, 15)
    page.evaluate('() => window.__shot.settle()')
    save(without_statusbar(shrink(page_image(page))), 'fit-warning.jpg')


def shot_export(page) -> None:
    """The 1:1 pattern sheet for size M next to the front piece's grade nest (S-XL)."""
    from PIL import Image
    page.evaluate("() => window.__shot.drape({ frames: 0 })")
    svgs = page.evaluate("""async () => {
        const ex = await import('./src/export/index.js');
        return { sheet: window.__app.export.sheetSvg('M'), nest: ex.exportDocGradeNestSvg(window.__app.doc(), 'front') };
    }""")
    tiles = []
    for key in ('sheet', 'nest'):
        html = ('<!doctype html><html><body style="margin:0;background:#fff">'
                f'<div id="w" style="width:1400px">{svgs[key]}</div>'
                '<style>#w svg{width:100%;height:auto;display:block}</style></body></html>')
        sub = page.context.browser.new_page(device_scale_factor=SCALE)
        sub.set_content(html)
        tiles.append(trim(page_image(sub, full_page=True), pad=48))
        sub.close()
    height = 1000
    tiles = [t.resize((round(t.width * height / t.height), height), Image.LANCZOS) for t in tiles]
    save(strip(tiles, gap=40), 'export.png')


def shot_drape_gif(page) -> None:
    """Arrange, sew and drop: the first four seconds of a drape, as an animated GIF."""
    page.evaluate("() => window.__shot.drape({ frames: 0, scene: 'studio' })")
    torso(page, 25)
    frames = []
    for i in range(34):
        if i:
            page.evaluate('() => window.__app.sim.step(8)')
        img = png_from_data_url(page.evaluate('() => window.__shot.canvasPng()'))
        img = center_crop(img, round(img.height * 0.8), img.height)
        frames.append(img.resize((440, round(440 * img.height / img.width))))
    frames += [frames[-1]] * 10
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / 'drape.gif'
    pal = [f.quantize(colors=128, method=2, dither=0) for f in frames]
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=70, loop=0, optimize=True)
    print(f'  wrote {path.relative_to(ROOT)}  {len(frames)} frames  {path.stat().st_size // 1024} kB', flush=True)


SHOTS = {
    'hero': shot_hero,
    'editor': shot_editor,
    'fabrics': shot_fabrics,
    'bodies': shot_bodies,
    'skirt': shot_skirt,
    'dress': shot_dress,
    'fit': shot_fit,
    'export': shot_export,
    'drape': shot_drape_gif,
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('shots', nargs='*', help='shots to take (default: all)')
    ap.add_argument('--list', action='store_true', help='list the shots and exit')
    ap.add_argument('--url', help='app URL (default: start serve.py on a free port)')
    ap.add_argument('--headed', action='store_true', help='show the browser')
    ap.add_argument('--software', action='store_true',
                    help='render WebGL in software (SwiftShader, as on CI) instead of on the GPU')
    args = ap.parse_args()
    if args.list:
        for name, fn in SHOTS.items():
            print(f'{name:9} {fn.__doc__}')
        return 0
    unknown = [s for s in args.shots if s not in SHOTS]
    if unknown:
        print('unknown shot(s): ' + ', '.join(unknown) + ' — see --list')
        return 2
    try:
        from playwright.sync_api import sync_playwright
        import PIL  # noqa: F401
    except ImportError:
        print('Needs:  python -m pip install playwright pillow  &&  python -m playwright install chromium')
        return 2

    server = None
    url = args.url
    if not url:
        port = free_port()
        server = start_server(port)
        url = f'http://127.0.0.1:{port}/'
    app_url = url + ('&' if '?' in url else '?') + 'autosave=0'
    errors: list[str] = []
    t0 = time.time()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed, args=CHROMIUM_ARGS if args.software else GPU_ARGS)
            page = browser.new_page(viewport=VIEWPORT, device_scale_factor=SCALE)
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(app_url, wait_until='load', timeout=120_000)
            page.wait_for_function('() => window.__app && window.__app.ready', timeout=120_000)
            boot = page.evaluate('async () => { const r = await window.__app.ready; return { ok: r.ok, errors: r.errors }; }')
            if not boot['ok']:
                print('boot failed: ' + '; '.join(map(str, boot['errors'])))
                return 1
            page.add_script_tag(content=HELPERS)
            page.evaluate('() => window.__shot.hideTearsUnlessAsked()')
            for name in (args.shots or list(SHOTS)):
                print(f'{name}…', flush=True)
                SHOTS[name](page)
            browser.close()
    finally:
        if server:
            server.terminate()
    for e in errors:
        print(f'page error: {e}')
    print(f'done in {time.time() - t0:.0f} s')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
