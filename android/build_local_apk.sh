#!/usr/bin/env bash
# ==============================================================================
# Samposhi Farm Automation — Local Android APK Builder
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "================================================================="
echo " Samposhi Farm Automation — Android APK Builder"
echo "================================================================="

cd "$ROOT_DIR"

# 1. Sync assets and generate icons
python3 "$SCRIPT_DIR/sync_assets.py"

# 2. Check Java availability
if ! command -v java >/dev/null 2>&1; then
    echo ""
    echo "[\033[93mNOTICE\033[0m] Java Runtime (JDK 17) was not detected in PATH."
    echo ""
    echo "To compile this APK locally on your Mac, choose one of these options:"
    echo "  1. Open in Android Studio:"
    echo "     Launch Android Studio -> File -> Open -> Select '$SCRIPT_DIR'"
    echo "     Then click: Build -> Build Bundle(s) / APK(s) -> Build APK(s)"
    echo ""
    echo "  2. Install OpenJDK via Homebrew:"
    echo "     brew install openjdk@17"
    echo "     sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk"
    echo ""
    echo "  3. Automated Cloud Build (Recommended & Zero Setup):"
    echo "     Push this project to GitHub (via GitHub Desktop) — GitHub Actions will"
    echo "     automatically build and attach 'SamposhiFarm-v2.0-debug.apk' under the Actions tab!"
    echo "================================================================="
    exit 0
fi

echo "[\033[92mBUILD\033[0m] Found Java: $(java -version 2>&1 | head -n 1)"
echo "[\033[92mBUILD\033[0m] Compiling Android APK with Gradle..."

cd "$SCRIPT_DIR"
chmod +x gradlew
./gradlew assembleDebug

OUT_APK="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$OUT_APK" ]; then
    FINAL_APK="$ROOT_DIR/MobileApp_v2/SamposhiFarm-v2.0.apk"
    cp "$OUT_APK" "$FINAL_APK"
    echo "================================================================="
    echo "[\033[92mSUCCESS\033[0m] APK built successfully!"
    echo "  Output location: $FINAL_APK"
    echo "================================================================="
fi
