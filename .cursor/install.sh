#!/usr/bin/env bash
# Cloud Agent install for makruk-engine.
#
# Idempotent, non-interactive dependency refresh + source-derived generation.
# The base image already ships Rust, Node and Python; this only adds the WASM
# toolchain and produces the generated wasm package under pkg/.
set -euo pipefail

WB_VERSION="0.2.100"

echo "==> Ensuring wasm32-unknown-unknown Rust target"
rustup target add wasm32-unknown-unknown

# The WASM build needs the wasm-bindgen CLI at the exact version of the
# wasm-bindgen crate (pinned to ${WB_VERSION} in Cargo.toml) — the generated
# JS glue and the wasm carry a schema version that must match byte-for-byte.
# --locked pins the CLI's own transitive deps so it builds under the image's
# Cargo toolchain (a newer floating dep otherwise requires edition2024).
if wasm-bindgen --version 2>/dev/null | grep -Fxq "wasm-bindgen ${WB_VERSION}"; then
  echo "==> wasm-bindgen ${WB_VERSION} already installed"
else
  echo "==> Installing wasm-bindgen-cli ${WB_VERSION}"
  cargo install wasm-bindgen-cli --version "${WB_VERSION}" --locked --force
fi

echo "==> Building native release binary"
cargo build --release

echo "==> Building WASM package (pkg/web + pkg/node)"
npm run build:wasm

echo "==> Install complete"
