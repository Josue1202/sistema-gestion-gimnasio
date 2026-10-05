# 📋 Guía Rápida de Operación · Zona Fitness

Guía práctica de uso diario para el personal de recepción y administración de **Zona Fitness**.


---

## 1. Acceso al Sistema

- **En la computadora del gimnasio:** Abre Google Chrome y entra a: `http://localhost:3000`
- **Desde otra PC o tablet en la misma red:** `http://IP-DEL-GIMNASIO:3000`
- **Usuario:** `admin@gimnasio.local` (o el correo asignado)
- **Contraseña:** *(la definida en la configuración inicial)*

---

## 2. En la Mañana: Abrir la Caja del Turno

1. En el menú superior, haz clic en **Caja**.
2. Escribe el **Monto de Apertura** (el sencillo o cambio en efectivo que hay en el cajón físico).
3. Haz clic en **✓ Abrir Caja Ahora**.
> ⚠️ **Importante:** Si no abres la caja, los cobros de membresías y ventas de agua/bebidas no quedarán registrados en el turno del día.

---

## 3. Todo el Día: Control de Acceso (Check-in en 2 Segundos)

1. En el menú superior, entra a **⚡ Check-in** (`/asistencia`).
2. Pídele el **DNI** al socio (o escanea su carnet con el lector de código de barras).
3. Presiona la tecla **ENTER**:
   - 🟢 **Verde ("Acceso Concedido") + Sonido agudo:** El socio está al día. Puede ingresar.
   - 🟡 **Amarillo ("Vence Pronto"):** Le quedan menos de 7 días. Recuérdale que su plan está por vencer.
   - 🔴 **Rojo ("Membresía Vencida") + Sonido de alerta:** Su plan expiró. Haz clic en el botón azul **"Cobrar / Renovar Plan"** para regularizar su pago.

---

## 4. Cómo Cobrar o Renovar una Membresía

1. Entra a la ficha del socio y pulsa **💳 Renovar / Cobrar**.
2. **Selecciona el Plan** (ej. Mensual S/ 120, Trimestral S/ 300).
3. La fecha de inicio y fin se calculan solas:
   - Si el socio ya tiene días vigentes, pulsa el botón **"Al vencer"** para que el nuevo plan empiece al día siguiente de su vencimiento sin perder días.
   - Si es nuevo o vencido, pulsa **"Hoy"**.
4. Selecciona el **Método de Pago** (💵 Efectivo, 🟣 Yape, 🔵 Plin o 💳 Tarjeta POS).
5. Haz clic en **✓ Guardar Pago y Ver Ticket**.
6. **Entrega de Comprobante:**
   - Para ticketera física: Haz clic en **🖨️ Imprimir Ticket**.
   - Para enviar a su celular: Haz clic en **📲 Enviar a WhatsApp**.

---

## 5. Venta de Bebidas, Agua o Suplementos (Mostrador)

1. En el menú superior, ve a **🥤 Productos**.
2. Ubica el producto (ej. *Agua San Luis 650ml*).
3. Escribe la cantidad, elige el método de cobro (Efectivo o Yape) y haz clic en **Vender**.
4. El dinero entra inmediatamente a la caja abierta y descuenta el stock del producto.

---

## 6. En la Noche: Cierre de Turno y Cuadre de Caja

1. Ve a **💰 Caja**.
2. En la sección **Cerrar Caja (Fin de Turno)**:
   - Cuenta todo el dinero en efectivo que hay físicamente en el cajón.
   - Escribe el número en **Efectivo Físico Contado**.
3. Haz clic en **🔒 Cerrar Turno y Guardar Cuadre**.
4. El sistema comparará lo contado contra lo que debió entrar:
   - Si cuadra exacto: Aparece mensaje verde ✓.
   - Si falta o sobra dinero: El sistema calcula la diferencia automáticamente para el reporte del dueño.

---

## 7. Preguntas Frecuentes y Solución de Problemas

### ¿Qué hago si la computadora se apagó o reinició?
1. En el escritorio de Windows, haz doble clic en el archivo **`Iniciar sistema.cmd`**.
2. Espera 10 segundos y vuelve a abrir Google Chrome en `http://localhost:3000`. Todos tus datos siguen intactos.

### ¿Cómo sé si el WhatsApp del gimnasio está conectado?
- En la esquina superior derecha del sistema hay un botón:
  - 🟢 **"WhatsApp Conectado":** Los recordatorios y comprobantes se envían automáticamente.
  - 🔴 **"Vincular WhatsApp":** Haz clic en él, abre WhatsApp en el teléfono del gimnasio > *Dispositivos vinculados* y escanea el código QR que sale en pantalla.
