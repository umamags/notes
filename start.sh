#!/usr/bin/env sh
# Build (if needed) and serve Folio on http://127.0.0.1:8080
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
[ -f public/index.html ] && [ -d public/assets ] || npm run build
exec php -d upload_max_filesize=64M -d post_max_size=64M -d memory_limit=256M -S "${HOST:-127.0.0.1}:${PORT:-8080}" -t public public/router.php
