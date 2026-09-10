# Operación — modo "en esta PC"

El sistema corre con Docker en esta computadora. No hay servidor ni costo.

## Arranque automático (ya configurado)

Al **iniciar sesión en Windows** se levanta todo solo:

1. `Startup\Docker Desktop.lnk` → abre Docker Desktop.
2. `Startup\GymSystem-Autostart.lnk` → ejecuta `scripts\autostart.ps1`, que:
   - espera a que Docker esté listo,
   - hace `docker compose up -d`,
   - hace un **backup** si el último tiene más de 20 h.

Los contenedores además tienen `restart: unless-stopped`: si Docker se reinicia,
vuelven solos.

> **Requisito:** alguien tiene que **iniciar sesión** en Windows (Docker Desktop
> necesita la sesión del usuario). Ideal: que la PC de recepción inicie sesión
> automáticamente.

Log del arranque: `C:\GYM\logs\autostart.log`

## Uso diario (doble clic)

| Archivo | Para qué |
|---|---|
| `Iniciar sistema.cmd` | Encender manualmente |
| `Detener sistema.cmd` | Apagar (los datos NO se borran) |
| `Estado y logs.cmd` | Ver si está arriba y las últimas líneas de la app |
| `Hacer backup.cmd` | Backup manual a `backups\` |

App: **http://localhost:3000** — desde otra PC de la misma red: `http://IP-DE-ESTA-PC:3000`

## Backups

- Automático: al arrancar, si el último tiene +20 h. Se guardan los **14 más recientes** en `C:\GYM\backups\`.
- Manual: `Hacer backup.cmd`.
- **Recomendado:** copiá de vez en cuando la carpeta `backups\` a un USB o a Google Drive. Si se muere el disco, ahí está todo.

### Restaurar un backup

```powershell
cd C:\GYM
docker compose cp "backups\gym_FECHA.dump" postgres:/tmp/r.dump
docker compose exec -T postgres sh -c "pg_restore -U gym -d gym --clean --if-exists /tmp/r.dump && rm /tmp/r.dump"
docker compose restart app n8n
```

## Actualizar el sistema (si hay cambios en el código)

```powershell
cd C:\GYM
git pull
docker compose up -d --build
```

## Backup diario a hora fija (opcional, requiere admin)

El backup "al arrancar" alcanza si prenden la PC casi todos los días. Si querés
uno a hora fija igual, abrí **PowerShell como administrador** y pegá:

```powershell
$a = New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\GYM\scripts\backup.ps1"'
$t = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName GymSystem-Backup -Action $a -Trigger $t -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Description "Backup diario del gimnasio" -Force
```

Lo mismo para el arranque, si preferís tarea programada en vez del acceso directo:

```powershell
$a = New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\GYM\scripts\autostart.ps1"'
$t = New-ScheduledTaskTrigger -AtLogOn ; $t.Delay = 'PT60S'
Register-ScheduledTask -TaskName GymSystem-Autostart -Action $a -Trigger $t -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Force
```

(y borrá `Startup\GymSystem-Autostart.lnk` para no duplicar).

## Si algo falla

```powershell
cd C:\GYM
docker compose ps
docker compose logs --tail 50 app
docker compose logs --tail 50 n8n
docker compose logs --tail 50 evolution-api
```

- **WhatsApp desconectado:** genera un QR nuevo y reescanéalo —
  `http://localhost:8080/instance/connect/gym` (header `apikey`).
- **La app no abre:** `docker compose restart app`
- **Todo raro:** `docker compose down` y luego `Iniciar sistema.cmd` (los datos se conservan en los volúmenes).
