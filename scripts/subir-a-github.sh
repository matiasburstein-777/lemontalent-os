#!/bin/bash
# Correr en el Shell de Replit para subir a GitHub los cambios hechos en Replit (Maga / Agent de Replit).
# Sube solo los archivos versionados, nunca zipFile.zip ni data/ (datos reales).
set -e
cd "$HOME/workspace" 2>/dev/null || cd "$(dirname "$0")/.."
REPO=https://github.com/matiasburstein-777/lemontalent-os.git
MSG="${1:-cambios desde Replit $(date '+%F %H:%M')}"
T=$(mktemp -d)
git clone -q --depth 1 "$REPO" "$T"
# Espejar archivos versionados de Replit sobre el clon (sin datos reales)
(cd "$T" && git ls-files -z | xargs -0 rm -f)
git ls-files | grep -vE '^(zipFile\.zip|data/)' | tar -cf - -T - | tar -xf - -C "$T"
cd "$T"
git add -A
if git diff --cached --quiet; then echo "Nada para subir."; exit 0; fi
git diff --cached --stat | tail -20
git -c user.name=matiasburstein-777 -c user.email=matiasburstein@gmail.com commit -qm "$MSG"
git push -q origin main
echo "OK: subido a GitHub."
