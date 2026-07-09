$env:NODE_ENV="development"
$env:PORT="8080"
$env:DATABASE_URL="postgresql://neondb_owner:npg_KSlfi7Vu4ELb@ep-broad-dream-as2wz1ts.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"

pnpm.cmd --filter @workspace/api-server run start