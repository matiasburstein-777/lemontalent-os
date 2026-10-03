#!/bin/bash
# Correr en el Shell de Replit para traer los cambios hechos en GitHub (por Claude u otra sesión).
# Pisa solo los archivos que están en GitHub; no toca data/, zipFile.zip, .env ni la base.
# Después: Republish para que llegue a producción.
set -e
cd "$HOME/workspace" 2>/dev/null || cd "$(dirname "$0")/.."
REPO=https://github.com/matiasburstein-777/lemontalent-os.git
git fetch -q "$REPO" main
git diff --stat HEAD FETCH_HEAD -- . ':!zipFile.zip' | tail -20
git checkout FETCH_HEAD -- .
git rev-parse FETCH_HEAD > .github-sync
git add -A . ':!zipFile.zip' && git commit -qm "sync desde GitHub $(cut -c1-7 .github-sync)" || true
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q '^package'; then npm install --silent; fi
echo "OK: Replit al día con GitHub ($(cut -c1-7 .github-sync)). Falta Republish."
