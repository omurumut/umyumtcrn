#!/bin/bash
set -e
corepack enable
pnpm install --filter .
pnpm run build
