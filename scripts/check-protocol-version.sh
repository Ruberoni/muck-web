#!/usr/bin/env bash
# Falla si los cambios desde BASE tocan la simulación, el protocolo, el servidor o las dependencias
# sin subir PROTOCOL_VERSION (src/net/protocol.ts): un cliente y un servidor de versiones distintas
# no deben jugar juntos. Los tests no cuentan.
# Uso: scripts/check-protocol-version.sh [BASE]   (por defecto origin/main)
set -euo pipefail

base="${1:-origin/main}"
file=src/net/protocol.ts
version_of() { grep -oE 'PROTOCOL_VERSION = [0-9]+' | grep -oE '[0-9]+$' || true; }

changed=$(git diff --name-only "$base" HEAD -- src/sim server "$file" package-lock.json ':(exclude)*.test.ts')
if [ -z "$changed" ]; then
  echo "Sin cambios en la simulación, el protocolo, el servidor ni las dependencias."
  exit 0
fi

old=$({ git show "$base:$file" 2>/dev/null || true; } | version_of)
new=$(version_of < "$file")
echo "Cambiado desde $base:"
echo "$changed" | sed 's/^/  /'
if [ -z "$new" ]; then
  echo "::error file=$file::No se encuentra PROTOCOL_VERSION."
  exit 1
fi
if [ "$old" = "$new" ]; then
  echo "::error file=$file::Estos cambios afectan a la simulación o al protocolo: sube PROTOCOL_VERSION (ahora $new)."
  exit 1
fi
echo "PROTOCOL_VERSION: ${old:-ninguna} → $new"
