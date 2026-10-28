#!/bin/sh
# Apply pending DB migrations, then start the server.
set -e
node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma
exec node dist/server.js
