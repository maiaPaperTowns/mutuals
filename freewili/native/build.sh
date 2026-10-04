#!/bin/bash
# Build Photon Pup as a FREE-WILi OG app (FwOGapp UF2) with the official wiliOGbsp.
#   ./native/setup_toolchain.sh   (once)      ./native/build.sh      → native/out/photon_main.uf2
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BSP="$HERE/.bsp"
[ -d "$BSP" ] || git clone -q --depth 1 https://github.com/freewili/wiliOGbsp "$BSP"
ln -sfn "$HERE/photon" "$BSP/apps/photon"
grep -q "add_subdirectory(apps/photon)" "$BSP/CMakeLists.txt" || echo "add_subdirectory(apps/photon)" >> "$BSP/CMakeLists.txt"
# upstream lists some apps that aren't in the repo; drop those lines so configure succeeds
python3 - "$BSP" <<'PY'
import re, sys, pathlib
bsp = pathlib.Path(sys.argv[1]); cm = bsp / "CMakeLists.txt"
lines = cm.read_text().splitlines(True)
keep = [l for l in lines if not (m := re.match(r"\s*add_subdirectory\((apps/[\w-]+)\)", l)) or (bsp / m.group(1)).exists()]
cm.write_text("".join(keep))
PY
[ -f "$HERE/photon/display/photon_assets.c" ] || (cd "$HERE/.." && .venv/bin/python native/make_assets.py)
python3 "$HERE/make_sounds.py"
cd "$BSP"
cmake --preset target-posix > /tmp/photon_cmake.log 2>&1 || { tail -30 /tmp/photon_cmake.log; exit 1; }
cmake --build build --target photon_main 2>&1 | tail -15
mkdir -p "$HERE/out"
find build -name "photon_main.uf2" -exec cp {} "$HERE/out/" \;
ls -la "$HERE/out/"
