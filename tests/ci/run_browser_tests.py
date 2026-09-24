#!/usr/bin/env python3
"""Run the app's in-browser test suites in headless Chromium, locally or on CI.

The tests live in the page, not in Python: every module's `runSelfTest()` and the acceptance suite of
tests/acceptance.js both run inside the booted app, through the `window.__app` automation API. This script
only starts a browser, boots the app, runs them, and turns the results into an exit code, a readable
table, GitHub annotations and a job summary.

    python tests/ci/run_browser_tests.py --serve            # start serve.py on a free port and test it
    python tests/ci/run_browser_tests.py --url https://bruno-prda.github.io/Clothing-CAD/

Needs:  python -m pip install playwright  &&  python -m playwright install chromium

Two kinds of failure are not failures of the build:
  * EXPECTED_FAILURES: checks that are red on purpose and documented (SPEC section 13). If one starts
    passing, the run says so, so the entry can be removed.
  * TIMING: assertions about speed. They are tuned on a desktop with a GPU; a shared CI runner renders
    WebGL in software and is several times slower. With --timing warn (the CI default) a failure whose
    message is exactly that timing assertion is reported as a warning. Any other failure in the same test
    still fails the build.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = ROOT / 'tests' / 'ci' / 'report'

# Acceptance checks that are red on purpose: id -> (pattern the failure must match, why).
EXPECTED_FAILURES = {
    '10': (r'p99 tensile strain', 'strain_cotton: p99 strain ~6.4 % against a 5 % target, left red on purpose (SPEC 13)'),
}

# Timing assertions, by test, and the exact failure text each one produces.
TIMING_ACCEPTANCE = {
    '01': r'boot took \d+ ms \(limit 8000\)',
    '07': r'buildMs [\d.]+ >= 1500',
    '11': r'msAvg [\d.]+ ms >= 16',
    '15': r"took [\d.]+ ms \(>= 500\)",
    '27': r'the suite took [\d.]+ s \(limit 90 s\)',
}
TIMING_SELFTESTS = {
    'body/perf.full': r'(full|coarse) build \d+ ms',
    'cloth/perf.4k': r'msAvg',
    'core/ids/uid-hash': r'took [\d.]+ ms',
    'core/sdf/perf': r'took [\d.]+ ms \(limit 60\)',
    'geometry/remesh.performance': r'want < 200',
}

# The acceptance suite without check 03, which only re-runs the self-tests (they are run on their own first).
ACCEPTANCE_FILTER = r'^(?!(03|selftests)$)'

CHROMIUM_ARGS = [
    '--use-angle=swiftshader',      # WebGL in software: CI runners have no GPU
    '--enable-unsafe-swiftshader',  # recent Chromium only falls back to SwiftShader for WebGL with this
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_server(port: int) -> subprocess.Popen:
    proc = subprocess.Popen([sys.executable, 'serve.py', str(port), '--no-open'], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.5):
                return proc
        except OSError:
            time.sleep(0.2)
    proc.kill()
    raise SystemExit(f'serve.py did not start on port {port}')


def classify(kind: str, key: str, name: str, passed: bool, details: str, timing_mode: str) -> str:
    """-> 'pass' | 'fail' | 'expected-fail' | 'unexpected-pass' | 'timing'"""
    if kind == 'acceptance' and key in EXPECTED_FAILURES:
        pattern, _why = EXPECTED_FAILURES[key]
        if passed:
            return 'unexpected-pass'
        return 'expected-fail' if re.search(pattern, details) else 'fail'
    if passed:
        return 'pass'
    if timing_mode == 'warn':
        pattern = TIMING_ACCEPTANCE.get(key) if kind == 'acceptance' else TIMING_SELFTESTS.get(name)
        if pattern and re.search(pattern, details):
            return 'timing'
    return 'fail'


def gh(line: str) -> None:
    """GitHub workflow command (annotation); a harmless line anywhere else."""
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        print(line, flush=True)


def esc(s: str) -> str:
    return s.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', help='app URL to test (default: http://127.0.0.1:<port>/ with --serve)')
    ap.add_argument('--serve', action='store_true', help='start serve.py on a free port and test it')
    ap.add_argument('--timing', choices=['warn', 'strict'], default='strict',
                    help='timing assertions: fail the run (strict, default) or only warn (CI)')
    ap.add_argument('--timeout-scale', type=float, default=1.0, help='multiply every acceptance check timeout')
    ap.add_argument('--headed', action='store_true', help='show the browser (debugging)')
    ap.add_argument('--only', choices=['selftests', 'acceptance'], help='run one suite')
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('Playwright is not installed:  python -m pip install playwright && python -m playwright install chromium')
        return 2

    server = None
    url = args.url
    if args.serve or not url:
        port = free_port()
        server = start_server(port)
        url = f'http://127.0.0.1:{port}/'
    sep = '&' if '?' in url else '?'
    app_url = url + sep + 'autosave=0'

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    page_errors: list[str] = []
    boot = None
    t0 = time.time()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed, args=CHROMIUM_ARGS)
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            page.on('pageerror', lambda e: page_errors.append(str(e)))
            print(f'Opening {app_url}', flush=True)
            page.goto(app_url, wait_until='load', timeout=120_000)
            page.wait_for_function('() => window.__app && window.__app.ready', timeout=120_000)
            boot = page.evaluate("""async () => {
                const r = await window.__app.ready;
                const gl = document.createElement('canvas').getContext('webgl2');
                const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
                return { ok: r.ok, ms: Math.round(r.ms), errors: r.errors,
                         renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? 'webgl2' : 'no webgl2'),
                         template: !!(window.__app.body.modelLive() || {}).source };
            }""")
            print(f"Boot: ok={boot['ok']} in {boot['ms']} ms, template body={boot['template']}, renderer={boot['renderer']}", flush=True)
            if not boot['ok']:
                for e in boot['errors']:
                    print(f"  boot error: {e}")

            if boot['ok'] and args.only in (None, 'selftests'):
                print('Running the self-tests…', flush=True)
                res = page.evaluate('async () => await window.__app.selftest.run()')
                for r in res:
                    rows.append({'kind': 'selftest', 'key': r['name'], 'name': r['name'],
                                 'pass': bool(r['pass']), 'details': str(r['details'])})

            if boot['ok'] and args.only in (None, 'acceptance'):
                print('Running the acceptance suite…', flush=True)
                acc = page.evaluate("""async ([filter, scale]) => {
                    const r = await window.__app.acceptance.run(new RegExp(filter), { log: false, timeoutScale: scale });
                    return { errors: r.errors || [], results: r.results.map((x) => ({ id: x.id, name: x.name, pass: !!x.pass,
                             ms: Math.round(x.ms || 0), details: String(x.details || '') })) };
                }""", [ACCEPTANCE_FILTER, args.timeout_scale])
                for r in acc['results']:
                    rows.append({'kind': 'acceptance', 'key': r['id'], 'name': r['name'], 'pass': r['pass'],
                                 'details': r['details'], 'ms': r['ms']})
                for e in acc['errors']:
                    page_errors.append('acceptance runner: ' + str(e))

            try:
                page.screenshot(path=str(REPORT_DIR / 'app.png'))
            except Exception as e:  # a screenshot is a debugging aid, never a reason to fail
                print(f'(screenshot failed: {e})')
            browser.close()
    finally:
        if server:
            server.terminate()

    # ------------------------------------------------------------------ verdict
    for r in rows:
        r['status'] = classify(r['kind'], r['key'], r['name'], r['pass'], r['details'], args.timing)
    counts = {s: sum(1 for r in rows if r['status'] == s) for s in ('pass', 'fail', 'expected-fail', 'unexpected-pass', 'timing')}
    boot_failed = not boot or not boot.get('ok')
    failed = boot_failed or counts['fail'] > 0 or bool(page_errors)

    icon = {'pass': 'ok  ', 'fail': 'FAIL', 'expected-fail': 'xfail', 'unexpected-pass': 'XPASS', 'timing': 'slow'}
    print()
    for r in rows:
        if r['status'] != 'pass':
            print(f"{icon[r['status']]:5} {r['kind']:10} {r['key']:<32} {r['details'][:300]}")
    print(f"\n{counts['pass']} passed, {counts['fail']} failed, {counts['timing']} timing warnings, "
          f"{counts['expected-fail']} expected failures, {counts['unexpected-pass']} unexpectedly passing, "
          f"{len(page_errors)} page errors — {time.time() - t0:.0f} s")

    for r in rows:
        title = f"{r['kind']} {r['key']}" + (f" {r['name']}" if r['kind'] == 'acceptance' else '')
        if r['status'] == 'fail':
            gh(f"::error title={esc(title)}::{esc(r['details'][:1000])}")
        elif r['status'] == 'timing':
            gh(f"::warning title=Timing: {esc(title)}::{esc(r['details'][:500])} (slower CI runner; not a failure)")
        elif r['status'] == 'unexpected-pass':
            gh(f"::notice title=Now passing: {esc(title)}::Remove it from EXPECTED_FAILURES in tests/ci/run_browser_tests.py")
    for e in page_errors:
        gh(f"::error title=Uncaught page error::{esc(e[:1000])}")
    if boot_failed:
        gh(f"::error title=Boot failed::{esc(json.dumps(boot)[:1000])}")

    (REPORT_DIR / 'results.json').write_text(json.dumps({'url': url, 'boot': boot, 'counts': counts,
                                                         'pageErrors': page_errors, 'rows': rows}, indent=1), encoding='utf-8')

    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write(f"## {'❌ Tests failed' if failed else '✅ Tests passed'}\n\n")
            f.write(f"Boot {boot['ms'] if boot else '?'} ms · renderer `{boot.get('renderer') if boot else '?'}`\n\n")
            f.write('| Result | Count |\n|---|---|\n')
            for k, label in (('pass', 'Passed'), ('fail', 'Failed'), ('timing', 'Timing warnings (slow runner)'),
                             ('expected-fail', 'Expected failures'), ('unexpected-pass', 'Unexpectedly passing')):
                f.write(f'| {label} | {counts[k]} |\n')
            f.write(f'| Uncaught page errors | {len(page_errors)} |\n\n')
            notable = [r for r in rows if r['status'] != 'pass']
            if notable:
                f.write('| | Test | Details |\n|---|---|---|\n')
                for r in notable:
                    d = r['details'][:200].replace('|', '\\|').replace('\n', ' ')
                    f.write(f"| {icon[r['status']]} | {r['kind']} `{r['key']}` | {d} |\n")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
