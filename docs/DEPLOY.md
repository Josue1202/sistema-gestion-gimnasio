# Despliegue en Hetzner + Coolify

Objetivo: dejar el sistema corriendo 24/7 en un servidor propio, con HTTPS,
para que no dependa de una PC encendida.

Costo: ~€4-6/mes de servidor. Todo lo demas es gratis.

---

## Resumen

```
Internet
   |  HTTPS (Let's Encrypt, lo pone Coolify)
   v
[ Hetzner CAX11 ]  -- Coolify (Traefik) --> app / n8n / evolution-api
                                             \--> postgres (solo red interna)
```

Dominios sugeridos (subdominios de uno que ya tengas):
- `gym.tudominio.com`  -> app web
- `n8n.tudominio.com`  -> n8n
- `evo.tudominio.com`  -> Evolution API (para el QR y estado; protegido por API key)

---

## Parte A — Lo que haces TU (una vez)

### 1. Servidor en Hetzner

1. Crea cuenta en https://console.hetzner.cloud
2. **New Project** -> **Add Server**:
   - Location: cualquiera (Helsinki/Nuremberg estan bien para Peru)
   - Image: **Ubuntu 24.04**
   - Type: **CAX11** (ARM, 2 vCPU, 4 GB) — ~€3.79/mes
   - SSH Key: sube tu clave publica (`~/.ssh/id_ed25519.pub`; si no tienes,
     `ssh-keygen -t ed25519` en tu PC)
   - Crea el servidor y anota su **IP publica**

### 2. DNS

En tu proveedor de dominio, crea 3 registros **A** apuntando a la IP del servidor:

| Tipo | Nombre | Valor |
|------|--------|-------|
| A | `gym` | IP del servidor |
| A | `n8n` | IP del servidor |
| A | `evo` | IP del servidor |

(Propagacion: minutos a un par de horas.)

### 3. Repositorio git

Coolify despliega desde un repo. Crea uno **privado** en GitHub (gratis) y sube esto:

```bash
cd C:\GYM
git remote add origin https://github.com/TU_USUARIO/gym-system.git
git push -u origin main
```

### 4. Avisame

Pasame: **IP del servidor** + confirmame que tu clave SSH entra
(`ssh root@IP` desde tu PC). Con eso yo hago la Parte B por SSH.

---

## Parte B — Lo que hago YO por SSH (o tu, siguiendo esto)

### 5. Instalar Coolify

```bash
ssh root@IP_DEL_SERVIDOR
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Al terminar, abre `http://IP_DEL_SERVIDOR:8000`, crea el usuario admin de Coolify
y en **Settings** pon tu dominio para el panel (opcional) y tu email para Let's Encrypt.

### 6. Firewall

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 8000 && ufw --force enable
```

### 7. Proyecto y recurso en Coolify

1. **+ New** -> **Project** -> "Gimnasio".
2. Dentro del proyecto -> **+ New Resource** -> **Docker Compose** ->
   conecta el repo de GitHub (Coolify pedira instalar su GitHub App o una deploy key).
3. Branch: `main`. **Compose file**: `docker-compose.prod.yml`.
4. **Environment Variables**: pega el contenido de `.env.production.example`
   con los valores reales (genera los secretos con `openssl rand -hex N`).
5. **Domains**:
   - servicio `app` -> `https://gym.tudominio.com` (puerto 3000)
   - servicio `n8n` -> `https://n8n.tudominio.com` (puerto 5678)
   - servicio `evolution-api` -> `https://evo.tudominio.com` (puerto 8080)
   - `postgres` -> sin dominio (queda interno)
6. **Deploy**.

Coolify clona el repo, corre `db/init/*.sql` en el primer arranque de Postgres,
construye la imagen de `app` y levanta todo con HTTPS.

### 8. Puesta a punto (post-deploy)

```bash
# nombre del contenedor postgres (Coolify les pone sufijo)
docker ps --format '{{.Names}}' | grep postgres

# cargar planes/plantillas ya vino de db/init. Verifica:
docker exec -it <postgres> psql -U gym -d gym -c "SELECT count(*) FROM plantillas_mensaje;"
```

**n8n:** entra a `https://n8n.tudominio.com` (usuario/clave basic auth de las env vars).
- Crea la credencial Postgres `Gym Postgres (gym DB)` (host `postgres`, db `gym`, user `gym`, port 5432, pass = `POSTGRES_PASSWORD`).
- Importa los 6 workflows de `n8n/workflows/` y actívalos.
  (o por CLI: `docker exec -it <n8n> n8n import:workflow --separate --input=/... ` tras copiarlos)

**WhatsApp:** crea la instancia y escanea el QR:
```bash
curl -X POST https://evo.tudominio.com/instance/create \
  -H "Content-Type: application/json" -H "apikey: TU_EVOLUTION_API_KEY" \
  -d '{"instanceName":"gym","integration":"WHATSAPP-BAILEYS","qrcode":true}'
# abre  https://evo.tudominio.com/instance/connect/gym  y escanea
```

### 9. Backups

En Coolify -> el recurso -> **Backups** -> agrega backup programado de la base
`gym` (diario) hacia un bucket S3/R2 (Cloudflare R2 tiene 10 GB gratis).
Sin S3, al menos deja el backup local que Coolify guarda en el servidor.

---

## Migrar los datos de tu PC (opcional)

Si ya cargaste socios/pagos en local y los quieres en el servidor:

```bash
# en tu PC
cd C:\GYM
docker compose exec -T postgres pg_dump -U gym -Fc gym > gym.dump

# subir y restaurar
scp gym.dump root@IP:/root/
ssh root@IP "docker exec -i <postgres> pg_restore -U gym -d gym --clean --if-exists < /root/gym.dump"
```

> Para que n8n siga pudiendo desencriptar sus credenciales, usa el **mismo**
> `N8N_ENCRYPTION_KEY` que tienes en local. Si no, recrea la credencial de Postgres
> en el n8n del servidor (2 minutos).

---

## Actualizar (deploy de cambios)

```bash
cd C:\GYM
git add -A && git commit -m "cambios" && git push
```
Coolify redepliega solo (si activaste auto-deploy) o le das **Deploy** en el panel.

---

## Notas

- La app confia en el proxy (`trust proxy`) y usa cookies `secure` en prod: requiere HTTPS, que Coolify da automatico.
- Postgres nunca queda expuesto a internet en esta config.
- WhatsApp no oficial: la sesion vive en el volumen `evolution_instances` y sobrevive reinicios. No hagas envios masivos.
- Si el servidor se reinicia, Coolify y los contenedores levantan solos.
