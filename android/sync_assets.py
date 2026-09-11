#!/usr/bin/env python3
"""
Samposhi Farm Automation — Android Asset & Icon Synchronization Engine
Copies latest web distribution into app/src/main/assets/ and generates
standard Android mipmap launcher icons from MobileApp_v2/icons/icon-512.png.
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path

ANDROID_DIR = Path(__file__).resolve().parent
MOBILE_DIR = ANDROID_DIR.parent
DIST_DIR = MOBILE_DIR / "dist"
ASSETS_DIR = ANDROID_DIR / "app" / "src" / "main" / "assets"
RES_DIR = ANDROID_DIR / "app" / "src" / "main" / "res"
SRC_ICON = MOBILE_DIR / "icons" / "icon-512.png"

def log(msg):
    print(f"[\033[92mSYNC\033[0m] {msg}")

def error(msg):
    print(f"[\033[91mERROR\033[0m] {msg}", file=sys.stderr)

def sync_web_assets():
    log("Synchronizing web assets into Android APK assets directory...")
    if not DIST_DIR.exists():
        log("dist/ not found, building first...")
        subprocess.run([sys.executable, str(MOBILE_DIR / "build_deployable.py"), "--esp32"], check=True)

    if ASSETS_DIR.exists():
        shutil.rmtree(ASSETS_DIR)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    copied_count = 0
    for root, dirs, files in os.walk(DIST_DIR):
        rel_path = Path(root).relative_to(DIST_DIR)
        target_dir = ASSETS_DIR / rel_path
        target_dir.mkdir(parents=True, exist_ok=True)
        for f in files:
            src_file = Path(root) / f
            dst_file = target_dir / f
            shutil.copy2(src_file, dst_file)
            copied_count += 1

    log(f"Successfully copied {copied_count} files into {ASSETS_DIR.relative_to(MOBILE_DIR)}.")

def generate_icons():
    log("Generating Android mipmap launcher icons...")
    if not SRC_ICON.exists():
        error(f"Source icon not found at: {SRC_ICON}")
        return

    icon_specs = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }

    has_sips = shutil.which("sips") is not None

    for folder_name, size in icon_specs.items():
        folder = RES_DIR / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        out_square = folder / "ic_launcher.png"
        out_round = folder / "ic_launcher_round.png"

        if has_sips:
            # macOS native high-quality image resizing tool
            subprocess.run(["sips", "-z", str(size), str(size), str(SRC_ICON), "--out", str(out_square)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            shutil.copy2(out_square, out_round)
        else:
            try:
                from PIL import Image
                with Image.open(SRC_ICON) as img:
                    resized = img.resize((size, size), Image.Resampling.LANCZOS)
                    resized.save(out_square)
                    resized.save(out_round)
            except ImportError:
                shutil.copy2(SRC_ICON, out_square)
                shutil.copy2(SRC_ICON, out_round)

        log(f"  ✓ Created {folder_name} icon ({size}x{size} px)")

    log("Android launcher icons generated successfully.")

def main():
    print("=" * 65)
    print(" Samposhi Farm Automation — Android Asset Synchronizer")
    print("=" * 65)
    sync_web_assets()
    generate_icons()
    print("=" * 65)
    log("All Android assets synchronized successfully.")
    print("=" * 65)

if __name__ == "__main__":
    main()
