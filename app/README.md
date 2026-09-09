# App web (pendiente)

Aca va la aplicacion Next.js: registro de socios, cobros, cierre de caja,
asistencia y tableros.

Cuando exista el codigo:

1. Descomenta el servicio `app` en `../docker-compose.yml`.
2. Crea aqui un `Dockerfile`.
3. La app se conecta a Postgres con `DATABASE_URL` y dispara webhooks a n8n
   en `http://n8n:5678/webhook/...`.

Variables que recibe (ver docker-compose.yml):

- `DATABASE_URL`
- `N8N_WEBHOOK_URL`
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
