# Estado de Pagos, Ahorro de Comisiones y Roadmap Futuro

Este documento resume la estrategia actual de pagos del sistema de gimnasio, el **ahorro económico real para el negocio al no usar pasarelas de pago externas con comisiones**, y la lista de opciones pendientes en caso de que en una Fase 2 el cliente desee habilitar cobro con tarjeta online o débito automático.

---

## 1. Cómo funciona el sistema hoy (100% GRATIS y Sin Comisiones)

El sistema opera con **registro y control de pagos internos**:

| Método | Cómo se cobra | Comisión del procesador | Costo mensual |
|---|---|---|---|
| **Efectivo** | En la recepción física | **S/ 0.00 (0%)** | **S/ 0.00** |
| **Yape / Plin** | El socio escanea el QR del gimnasio en recepción | **S/ 0.00 (0%)** | **S/ 0.00** |
| **Transferencia Bancaria** | BCP, BBVA, Interbank (móvil) | **S/ 0.00 (0%)** | **S/ 0.00** |
| **Tarjeta Física (POS)** | Con el POS del gimnasio (Izipay, Niubiz físico, etc.) | La que ya tenga su POS | No se paga nada extra al software |

### 💰 ¿Cuánto dinero le ahorra esto al dueño del gimnasio?
Las pasarelas de pago online automáticas (MercadoPago, Culqi, Stripe, Niubiz Online) cobran entre **3.45% y 4.99% + S/ 1.00 + IGV** por cada transacción:

- Con una facturación mensual de **S/ 10,000.00**:
  - Pasarela online retendría: **~S/ 450.00 a S/ 550.00 al mes**.
  - Al año, el gimnasio perdería: **~S/ 5,400.00 a S/ 6,600.00 en comisiones**.
- **Con este sistema:** El 100% del dinero entra íntegro al bolsillo del dueño del gimnasio sin pagar ni un solo centavo de comisión a intermediarios de software.

---

## 2. Lo que queda pendiente si en el futuro desean Cobro Online Automático

Si en el futuro el gimnasio crece y el cliente solicita expresamente que los socios paguen **desde una página web con tarjeta de crédito/débito o cobro recurrente automático**, aquí está la hoja de ruta técnica y los requisitos que necesitarán:

### A. Opciones de Pasarelas de Pago Evaluadas (Perú / LatAm)

#### Opción 1: Mercado Pago (Perú / Latinoamérica)
- **Costo**: ~3.99% + S/ 1.00 + IGV por cobro exitoso.
- **Ventajas**: Permite generar *Links de Pago* que se pueden enviar por WhatsApp con n8n automáticamente cuando una membresía está por vencer.
- **Requisitos del cliente**: Cuenta de Mercado Pago Empresas, RUC o DNI verificado, cuenta bancaria asociada.
- **Implementación técnica**:
  - Webhook de notificación IPN en Express (`POST /api/webhooks/mercadopago`).
  - Cuando el socio paga el link en su celular, Mercado Pago avisa al webhook y el sistema renueva la suscripción en Postgres automáticamente.

#### Opción 2: Culqi
- **Costo**: 3.79% + $0.30 + IGV por transacción.
- **Ventajas**: Formularios de pago limpios y soporte para cargos recurrentes / suscripciones mensuales automáticas con tarjeta de crédito.
- **Requisitos del cliente**: RUC 10 o 20 activo, cuenta bancaria en soles, contrato comercial con Culqi.

#### Opción 3: Niubiz (PagoEfectivo / Tarjetas)
- **Costo**: Variable según convenio comercial (desde 3.2% a 3.9% + IGV).
- **Ventajas**: Marca más reconocida en Perú (apoyada por Visanet).

---

## 3. Integraciones Físicas Futuras (Oportunidades de Venta Adicional)

Estas son mejoras de hardware que le puedes ofrecer al gimnasio como un **servicio extra o "Upgrade VIP"**:

1. **Lector de Código de Barras / QR USB para Recepción**:
   - Costo del hardware: ~$15 - $25 USD (S/ 60 - S/ 90).
   - Se conecta por USB a la PC de recepción y escribe el DNI/código al instante sin tocar el teclado. Ya es 100% compatible con la pantalla de `/asistencia` creada.
2. **Control de Acceso con Torniquete / Molinete y Relé**:
   - Integración con torniquete físico vía microcontrolador (ESP32 / Raspberry Pi) o protocolo ZKTeco / Dahua.
   - Cuando el socio marca y está activo, la app envía una señal HTTP o MQTT para abrir el pestillo eléctrico.
3. **Impresora Térmica de Tickets (58mm / 80mm USB o Bluetooth)**:
   - Costo del hardware: ~$25 - $40 USD.
   - Imprime los comprobantes de membresía generados en `/suscripciones/:id/ticket` en 1 segundo.
