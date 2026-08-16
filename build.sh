#!/usr/bin/env bash
# Compatibility shim — the build lives in build.mjs now.
cd "$(dirname "$0")"
exec node build.mjs
