#!/bin/bash
# One-time: Raspberry Pi Pico SDK 2.3.0 + Arm GNU toolchain 15.2.Rel1 + ninja, in the layout the FREE-WILi OG BSP
# (github.com/freewili/wiliOGbsp, preset target-posix) expects. Downloads are streamed, never stored (~1.1 GB on disk).
set -euo pipefail
P="$HOME/.pico-sdk"
mkdir -p "$P/toolchain/15_2_Rel1" "$P/ninja/v1.13.2" "$P/sdk"

if [ ! -x "$P/toolchain/15_2_Rel1/bin/arm-none-eabi-gcc" ]; then
  echo "== Arm GNU toolchain 15.2.Rel1 (darwin-arm64)"
  curl -fL "https://developer.arm.com/-/media/Files/downloads/gnu/15.2.rel1/binrel/arm-gnu-toolchain-15.2.rel1-darwin-arm64-arm-none-eabi.tar.xz" \
    | tar -xJ --strip-components=1 -C "$P/toolchain/15_2_Rel1"
fi
"$P/toolchain/15_2_Rel1/bin/arm-none-eabi-gcc" --version | head -1

if [ ! -x "$P/ninja/v1.13.2/ninja" ]; then
  echo "== ninja 1.13.2"
  curl -fL -o /tmp/ninja-mac.zip "https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-mac.zip"
  unzip -o -q /tmp/ninja-mac.zip -d "$P/ninja/v1.13.2" && rm /tmp/ninja-mac.zip
fi
"$P/ninja/v1.13.2/ninja" --version

if [ ! -d "$P/sdk/2.3.0/src" ]; then
  echo "== Pico SDK 2.3.0 (+ tinyusb)"
  git clone -q --depth 1 -b 2.3.0 https://github.com/raspberrypi/pico-sdk "$P/sdk/2.3.0"
  git -C "$P/sdk/2.3.0" submodule update -q --init --depth 1 lib/tinyusb
fi
echo "== done: $(du -sh "$P" | cut -f1) in $P"
df -h "$HOME" | tail -1 | awk '{print "free disk:", $4}'
