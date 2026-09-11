#!/usr/bin/env python3
"""
Samposhi Farm Automation — Mobile PWA & ESP32 Firmware Packaging Pipeline
Locks structure, produces static dist/ PWA, and generates v2/Master_v2/Webpage.h
"""

import os
import sys
import shutil
import base64
import json
import gzip
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DIST_DIR = BASE_DIR / "dist"
MASTER_V2_DIR = PROJECT_DIR / "v2" / "Master_v2"

def log(msg):
    print(f"[\033[92mBUILD\033[0m] {msg}")

def error(msg):
    print(f"[\033[91mERROR\033[0m] {msg}", file=sys.stderr)

def validate_assets():
    log("Validating MobileApp_v2 source assets...")
    required_files = [
        BASE_DIR / "index.html",
        BASE_DIR / "manifest.json",
        BASE_DIR / "sw.js",
        BASE_DIR / "css" / "app.css",
        BASE_DIR / "css" / "components.css",
        BASE_DIR / "js" / "app.js",
        BASE_DIR / "js" / "lighting.js",
        BASE_DIR / "js" / "scanner.js",
        BASE_DIR / "icons" / "icon-192.png",
        BASE_DIR / "icons" / "icon-512.png",
        BASE_DIR / "icons" / "icon-maskable-512.png",
        BASE_DIR / "icons" / "apple-touch-icon.png",
        BASE_DIR / "icons" / "favicon.png"
    ]
    for p in required_files:
        if not p.exists():
            error(f"Missing required asset: {p}")
            sys.exit(1)
        log(f"  ✓ Found {p.relative_to(BASE_DIR)} ({p.stat().st_size:,} bytes)")
    log("Asset validation complete.")

def build_dist_pwa():
    log(f"Generating static deployable PWA in: {DIST_DIR.relative_to(PROJECT_DIR)}...")
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    # Copy HTML, Manifest, Service Worker
    for f in ["index.html", "manifest.json", "sw.js"]:
        shutil.copy2(BASE_DIR / f, DIST_DIR / f)

    # Copy CSS
    shutil.copytree(BASE_DIR / "css", DIST_DIR / "css")

    # Copy JS
    shutil.copytree(BASE_DIR / "js", DIST_DIR / "js")

    # Copy Icons
    shutil.copytree(BASE_DIR / "icons", DIST_DIR / "icons")

    log(f"Static PWA package created with {len(list(DIST_DIR.rglob('*')))} files.")

def build_esp32_inlined_bundle(overwrite_master=False):
    log("Building self-contained single-file mobile bundle...")
    
    with open(BASE_DIR / "index.html", "r", encoding="utf-8") as f:
        html = f.read()

    with open(BASE_DIR / "css" / "app.css", "r", encoding="utf-8") as f:
        css_app = f.read()

    with open(BASE_DIR / "css" / "components.css", "r", encoding="utf-8") as f:
        css_components = f.read()

    with open(BASE_DIR / "js" / "lighting.js", "r", encoding="utf-8") as f:
        js_lighting = f.read()

    with open(BASE_DIR / "js" / "scanner.js", "r", encoding="utf-8") as f:
        js_scanner = f.read()

    with open(BASE_DIR / "js" / "app.js", "r", encoding="utf-8") as f:
        js_app = f.read()

    # Base64 encode favicon for lightweight standalone offline icon (2.2 KB)
    def to_b64(path):
        with open(path, "rb") as img_f:
            return base64.b64encode(img_f.read()).decode("ascii")

    fav_b64 = to_b64(BASE_DIR / "icons" / "favicon.png")
    html = html.replace('href="icons/favicon.png"', f'href="data:image/png;base64,{fav_b64}"')

    # Inline CSS stylesheets
    combined_css = f"<style>\n/* --- app.css --- */\n{css_app}\n/* --- components.css --- */\n{css_components}\n</style>"
    html = html.replace('<link rel="stylesheet" href="css/app.css">\n  <link rel="stylesheet" href="css/components.css">', combined_css)
    html = html.replace('<link rel="stylesheet" href="css/app.css">', '')
    html = html.replace('<link rel="stylesheet" href="css/components.css">', '')

    # Inline JS scripts
    combined_js = f"<script>\n/* --- lighting.js --- */\n{js_lighting}\n/* --- scanner.js --- */\n{js_scanner}\n/* --- app.js --- */\n{js_app}\n</script>"
    
    # Replace individual script tags
    html = html.replace('<script src="js/lighting.js"></script>', '')
    html = html.replace('<script src="js/scanner.js"></script>', '')
    html = html.replace('<script src="js/app.js"></script>', combined_js)

    # Always write standalone single-file bundle inside dist/
    out_html = DIST_DIR / "standalone_mobile.html"
    with open(out_html, "w", encoding="utf-8") as f:
        f.write(html)
    
    raw_size = len(html.encode("utf-8"))
    log(f"Generated standalone single-file HTML bundle: {out_html.relative_to(PROJECT_DIR)} ({raw_size:,} bytes)")

    # GZIP compress with level 9
    gz_data = gzip.compress(html.encode("utf-8"), compresslevel=9)
    gz_size = len(gz_data)
    savings = (1.0 - (gz_size / raw_size)) * 100.0
    log(f"GZIP Level 9 compression: {raw_size:,} bytes → {gz_size:,} bytes ({savings:.1f}% savings)")

    if overwrite_master:
        header_path = MASTER_V2_DIR / "Webpage.h"
        src_html = MASTER_V2_DIR / "webpage_source.html"
        log(f"[\033[93mWARNING\033[0m] Overwriting Master firmware header at {header_path.relative_to(PROJECT_DIR)}...")
        with open(src_html, "w", encoding="utf-8") as f:
            f.write(html)
        with open(header_path, "w", encoding="utf-8") as f_out:
            f_out.write("// ==========================================================================\n")
            f_out.write("// SAMPOSHI FARM AUTOMATION — PRE-COMPRESSED MOBILE PWA DASHBOARD\n")
            f_out.write("// Auto-generated by MobileApp_v2/build_deployable.py\n")
            f_out.write("// ==========================================================================\n\n")
            f_out.write("#ifndef WEBPAGE_H\n#define WEBPAGE_H\n\n#include <Arduino.h>\n\n")
            f_out.write(f"const uint32_t WEBPAGE_HTML_SIZE = {raw_size};\n")
            f_out.write(f"const uint32_t WEBPAGE_HTML_GZ_SIZE = {gz_size};\n")
            f_out.write("#define WEBPAGE_HTML_GZ_LEN WEBPAGE_HTML_GZ_SIZE\n\n")
            f_out.write("const uint8_t WEBPAGE_HTML_GZ[] PROGMEM = {\n  ")
            for i, b in enumerate(gz_data):
                f_out.write(f"0x{b:02X}, ")
                if (i + 1) % 16 == 0:
                    f_out.write("\n  ")
            f_out.write("\n};\n\n#endif // WEBPAGE_H\n")
        log(f"Successfully generated Webpage.h ({header_path.stat().st_size:,} bytes).")
    else:
        log("Master firmware Webpage.h untouched (desktop WebApp preserved).")

def main():
    import argparse
    import subprocess
    parser = argparse.ArgumentParser(description="Samposhi Farm Automation — Deployable PWA Builder")
    parser.add_argument("--esp32", action="store_true", help="Generate single-file standalone bundle in dist/")
    parser.add_argument("--android", action="store_true", help="Sync assets into MobileApp_v2/android project and generate Android mipmap icons")
    parser.add_argument("--overwrite-master", action="store_true", help="CAUTION: Overwrite v2/Master_v2/Webpage.h with mobile bundle")
    args = parser.parse_args()

    print("=" * 65)
    print(" Samposhi Farm Automation — Mobile PWA Builder")
    print("=" * 65)
    validate_assets()
    build_dist_pwa()

    if args.esp32 or args.overwrite_master:
        build_esp32_inlined_bundle(overwrite_master=args.overwrite_master)
    else:
        log("Standalone PWA built in dist/. ESP32 Master flash memory untouched.")

    if args.android:
        sync_script = BASE_DIR / "android" / "sync_assets.py"
        if sync_script.exists():
            log("Running Android asset & icon synchronization...")
            subprocess.run([sys.executable, str(sync_script)], check=True)

    print("=" * 65)
    log("Build complete! All artifacts generated successfully.")
    print("=" * 65)

if __name__ == "__main__":
    main()
