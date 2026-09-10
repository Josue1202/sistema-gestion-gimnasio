# Backup de la base 'gym' a C:\GYM\backups\  (conserva los ultimos 14).
# Hace el dump DENTRO del contenedor y lo copia afuera (evita problemas de
# codificacion de PowerShell con datos binarios).
$ErrorActionPreference = 'Stop'
$gym = 'C:\GYM'
$dir = "$gym\backups"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$name = "gym_{0}.dump" -f (Get-Date -Format 'yyyy-MM-dd_HHmm')

Set-Location $gym
& docker compose exec -T postgres sh -c "pg_dump -U gym -Fc -f /tmp/$name gym"
if ($LASTEXITCODE -ne 0) { throw "pg_dump devolvio $LASTEXITCODE" }
& docker compose cp "postgres:/tmp/$name" "$dir\$name"
& docker compose exec -T postgres rm -f "/tmp/$name"

$fi = Get-Item "$dir\$name"
if ($fi.Length -lt 1000) { Remove-Item $fi.FullName -Force; throw "backup demasiado chico ($($fi.Length) bytes)" }

Get-ChildItem "$dir\gym_*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Force
"[{0}] backup OK -> {1} ({2:N0} KB)" -f (Get-Date), $name, ($fi.Length / 1KB)
