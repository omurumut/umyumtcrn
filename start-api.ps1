Get-Content .env | ForEach-Object {
  if ($_ -match "^\s*([^#][^=]+)=(.*)$") {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim().Trim('"'), "Process")
  }
}

$env:PORT="8080"
$env:NODE_ENV="development"

pnpm.cmd --filter @workspace/api-server run build
pnpm.cmd --filter @workspace/api-server run start