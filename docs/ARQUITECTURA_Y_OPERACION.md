# 🏋️ Arquitectura y Operación — Zona Fitness Pro

Este documento describe la arquitectura completa, flujo de datos, servicios, puertos y procedimientos operativos del sistema **Zona Fitness Pro** desplegado en Coolify.

---

## 1. Topología de Servicios (Docker Compose)

El stack se compone de 4 contenedores interconectados mediante una red privada de Docker:

```
                          [ Internet / LAN / Tailscale ]
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
      Puerto 8084                  Puerto 5679                  Puerto 8085
           ▼                            ▼                            ▼
   ┌───────────────┐            ┌───────────────┐            ┌───────────────┐
   │      app      │            │      n8n      │            │ evolution-api │
   │ (Express/EJS) │◀──────────▶│ (Workflows)   │◀──────────▶│   (Baileys)   │
   └───────┬───────┘            └───────┬───────┘            └───────┬───────┘
           │                            │                            │
           │                     Red Interna                         │
           └───────────────────────────▶│◀───────────────────────────┘
                                        ▼
                               ┌─────────────────┐
                               │    postgres     │
                               │  (Postgres 16)  │
                               │  [gym,n8n,evo]  │
                               └─────────────────┘
```

### Tabla de Puertos y Enlaces

| Servicio | Puerto Host | Puerto Contenedor | URL de Acceso Local |
| :--- | :--- | :--- | :--- |
| **Zona Fitness Pro (Web)** | `8084` | `3000` | `http://100.117.103.36:8084` |
| **n8n Automation Engine** | `5679` | `5678` | `http://100.117.103.36:5679` |
| **Evolution API (WhatsApp)** | `8085` | `8080` | `http://100.117.103.36:8085` |
| **PostgreSQL 16** | *Aislado* | `5432` | Conexión interna `postgres:5432` |

---

## 2. Bases de Datos en PostgreSQL

El servidor Postgres gestiona 3 bases de datos con el usuario `gym`:

1. **`gym`**: Almacena las 28 tablas y vistas del negocio (Socios, Suscripciones, Pagos, Cajas, Asistencias, Plantillas de Mensajes, Usuarios).
2. **`n8n`**: Tablas internas de workflows y ejecuciones programadas.
3. **`evolution`**: Instancias y sesiones de WhatsApp.

---

## 3. Endpoints de Diagnóstico y Salud

- **Salud de la App:** `http://100.117.103.36:8084/health` -> Retorna `ok`
- **Diagnóstico de Base de Datos:** `http://100.117.103.36:8084/init-db` -> Retorna JSON con lista de bases de datos y tablas públicas creadas.
- **Salud de Evolution API:** `http://100.117.103.36:8085` -> Retorna JSON de bienvenida.
- **Panel de n8n:** `http://100.117.103.36:5679` -> Interfaz gráfica para diseñar y activar flujos.

---

## 4. Flujo de Trabajo Comercial

1. **Primer Acceso / Setup**:
   - Ingresar a `/setup` para crear la clave del usuario `admin@gimnasio.local`.
2. **Recepción y POS**:
   - Registro de socios nuevos con DNI y teléfono móvil.
   - Venta de planes y control de apertura/cierre de caja diaria.
3. **Control de Asistencia**:
   - Marcación por DNI o código QR para registrar la entrada.
   - Si la membresía está vencida, la pantalla alerta inmediatamente al recepcionista.
4. **WhatsApp y Cobranzas**:
   - Vincular WhatsApp desde la sección `/whatsapp`.
   - n8n consulta la vista `v_suscripciones_por_vencer` y envía el recordatorio automáticamente vía Evolution API.
