# Levanta el stack del gimnasio cuando arranca Windows y hace un backup si toca.
# Se ejecuta desde un acceso directo en la carpeta Inicio (no requiere admin).
$ErrorActionPreference = 'SilentlyContinue'
$gym = 'C:\GYM'
New-Item -ItemType Directory -Force -Path "$gym\logs" | Out-Null
$log = "$gym\logs\autostart.log"
function Log($m) { "[{0}] {1}" -f (Get-Date), $m | Out-File $log -Append }
Log "arranque"

# 1. Asegurar Docker Desktop iniciado
$dd = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
if ((Test-Path $dd) -and -not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
  Start-Process $dd; Log "lanzado Docker Desktop"
}

# 2. Esperar al engine (hasta 10 min)
$deadline = (Get-Date).AddMinutes(10)
do {
  & docker version --format '{{.Server.Version}}' *> $null
  $ok = ($LASTEXITCODE -eq 0)
  if (-not $ok) { Start-Sleep -Seconds 10 }
} while (-not $ok -and (Get-Date) -lt $deadline)
if (-not $ok) { Log "ERROR: el engine de Docker no respondio"; exit 1 }

# 3. Levantar el stack
Set-Location $gym
& docker compose up -d *>> $log
Log "docker compose up -d (exit $LASTEXITCODE)"

# 4. Backup si el ultimo tiene mas de 20 h (asi hay ~1 por dia sin tarea programada)
try {
  $last = Get-ChildItem "$gym\backups\gym_*.dump" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $last -or $last.LastWriteTime -lt (Get-Date).AddHours(-20)) {
    Start-Sleep -Seconds 20
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$gym\scripts\backup.ps1" *>> $log
    Log "backup ejecutado"
  } else {
    Log "backup reciente ($($last.Name)), se omite"
  }
} catch { Log "backup fallo: $($_.Exception.Message)" }
