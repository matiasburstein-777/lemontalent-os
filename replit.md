# Lemon Talent OS — contexto para el agente

Sistema interno de Lemon Talent, consultora de recruiting en Argentina. Reemplaza las planillas de búsquedas, weekly, facturación, clientes, economics y objetivos. Lo usan los socios (Pau, Matías) y las recruiters (Maga, Sabrina, Paula, Agustina).

**Idioma:** toda la interfaz y los mensajes van en español rioplatense ("vos", "cargá", "guardá").

## Ejecución en Replit

- Workflow: `Start application`, comando `npm run start`, puerto `5000`.
- PostgreSQL usa `DATABASE_URL`, administrada por Replit. Las tablas se preparan con `npm run db:push`.
- Para esta puesta en marcha no ejecutar `npm run setup` ni `npm run db:seed`: los datos importados no se cargan.
- El usuario cargará `ADMIN_PASSWORD` por su cuenta. Con `ADMIN_EMAIL`, `ADMIN_NOMBRE` y `ADMIN_PASSWORD` en Secrets, reiniciar el workflow para crear el primer socio si no hay usuarios.
- No se modificó código de la aplicación para esta puesta en marcha.

## Arquitectura

- `server/index.js`: Express. Login con sesión (tabla `session` en Postgres) y API REST.
- `server/db.js`: conexión a PostgreSQL con Drizzle (`DATABASE_URL`). `clean()` filtra columnas y convierte `""` en `null` para fechas y números.
- `shared/schema.js`: **fuente de verdad del modelo de datos**. Tras cambiarlo, correr `npm run db:push`.
- `public/index.html` + `public/app.js`: frontend en JavaScript sin framework ni build. `render()` dibuja la vista activa a partir del estado `S`, y cada vista es una función `vNombre()`.
  - Los formularios abren en un panel lateral (`openDrawer`).
  - Las escrituras pasan por `write("coleccion/id", data, "set"|"update"|"delete")`.
  - Los datos se refrescan cada 20 segundos y después de cada escritura.
- `scripts/seed.js`: carga inicial desde `data/*.json` (migración de las planillas). No pisa datos existentes.

## Roles y permisos (no romper)

Jerarquía: `recruiter` < `admin` (Administradora) < `socio` (constante `RANK` en `server/index.js`).

- `socio`: ve y edita todo.
- `admin` (Administradora): todo lo de recruiter más `facturas`, `busquedasFin`, `clientes`, `leads`, `config` (equipo y objetivos) y alta/edición de usuarios **recruiter**. En `meses` el servidor le quita el campo `gastos` y no puede escribir. Ve costos unitarios solo vía `GET /api/unit-costs` (ratios por año, nunca totales). **Carga gastos** (`gastos`, `gastosRecurrentes`) y marca pagos, pero el frontend no le muestra totales, resultado ni margen (decisión de los socios, oct-2026).
- `recruiter`: ve y edita `busquedas`, `candidatos`, `postulaciones` y `feedback`. **No puede leer** `facturas`, `busquedasFin`, `clientes`, `leads`, `meses` ni `config/objetivos`.
- Los permisos se aplican **en el servidor** (objeto `R` en `server/index.js`: `min` = rol mínimo para leer/escribir, `write` = rol mínimo para escribir si es más alto). Ocultar algo en el frontend no alcanza. Toda colección nueva con plata o datos comerciales lleva `min: "admin"`, y si incluye costos o resultado, `min: "socio"`.
- En el frontend: `isAdmin` = socio, `canFin` = socio o administradora.
- Borrar búsquedas, candidatos y pedidos de mejora es solo para socios.

## Modelo de datos

| Tabla | Para qué sirve |
|---|---|
| `busquedas` | Cada proceso: puesto, cliente, recruiter, estado (Activa / En pausa / Cerrada / Cancelada), fechas, candidato final, garantía, `bitacora` (actualizaciones semanales) y `minutas` (links de Granola). |
| `busquedas_fin` | Sueldo, fee y comisión de cada búsqueda. Solo socios. |
| `candidatos` | Base de talento reutilizable. `tags` y `minutas` en jsonb. |
| `postulaciones` | Candidato × búsqueda. Etapas: Sourcing → Contactado → Entrevista LT → Presentado → Entrevista cliente → Oferta → Contratado / Descartado. `etapas` (jsonb) es el historial de cambios de etapa y lo arma **solo el servidor** (`conEtapas` en `server/seguimiento.js`). Al descartar se pide `motivo` (lista fija) y `motivoDetalle`. |
| `links_cliente` | Link privado de solo lectura por búsqueda (`/c/<token>`), con textos revisados para el cliente. |
| `facturas` | Monto, moneda (ARS/USD), emisor (MATI / PAU / Invoice), tipo (Inicio y avance / Cierre / 50% anticipo / Cancelación), cobrada, comisión de la recruiter y si ya se pagó. `historico=true` son montos pre-dic-2024 tomados de la planilla. |
| `clientes`, `leads` | CRM. Cuando un lead pasa a "Ganado", el frontend crea el cliente. |
| `meses` | P&L. `historico=true` (ene-2023 a sep-2026) trae ingresos fijos de la planilla Economics. Desde oct-2026 los ingresos salen de `facturas` por fecha de emisión y las comisiones se suman solas como gasto. Acá solo se cargan el TC y los gastos fijos. |
| `gastos`, `gastos_recurrentes` | Gastos del negocio desde el primer mes que no viene de la planilla. Los recurrentes se cargan solos cada mes (fila `gr-<recurrente>-<mes>`, editable o "no corresponde este mes"); cada gasto tiene categoría, moneda y estado de pago. Ver `server/gastos.js`. Las líneas que antes se cargaban en `meses.gastos` se migraron solas a esta tabla. Un mes de planilla sin gastos (sep-26) se carga acá. Los conceptos de la planilla se categorizan con `catGasto` (solo para mostrar). "Sugerir desde la planilla" (socios) propone como recurrentes los gastos que se repiten en los últimos 4 meses de la planilla. |
| `config` | `equipo` (recruiters, capacidad, % comisión, ICPs) y `objetivos` (facturación mensual, ticket, time to fill, etc.). |
| `feedback` | Pedidos de mejora del equipo, con estado y respuesta. |

## Seguimiento de búsquedas (`server/seguimiento.js`)

- **Ficha de búsqueda** (`#busqueda/<id>`, `vFicha`): KPIs, funnel, estado y bitácora, pipeline, tiempo por etapa y descartes por motivo. "Editar" abre el panel lateral de siempre.
- **Funnel real**: cuenta cuántos candidatos *llegaron* a cada etapa según su historial (`alcance`), incluidos los descartados hasta donde llegaron.
- **Semáforo** (`salud`): en riesgo si no hay movimiento hace más de 7 días, no hay terna a los 21 días o no quedan candidatos vivos; atención si no hay movimiento hace más de 4 días o quedan menos de 3 vivos. Las reglas de cantidad de candidatos esperan 7 días desde el inicio. Las tarjetas de Búsquedas muestran semáforo, funnel chico, vivos y presentados, y se ordenan por riesgo (por defecto), días abierta, último movimiento, cliente o más recientes. La vista Tabla queda para el historial.
- **Link para el cliente**: `GET/POST/DELETE /api/links/:busquedaId` (cualquier usuario logueado; `alcance` = `busqueda` o `cliente`) y la página pública `/c/:token`, sin login. Un link de cliente (`links_cliente.cliente`, sin `busqueda_id`) muestra todas sus búsquedas abiertas. Muestra estado, funnel, candidatos presentados en tarjetas con el `comentarioCliente` de cada postulación (opción de ocultar descartados) y los textos del link. Nunca montos, notas internas, contactos ni semáforo.
- **Opinión del cliente**: en cada candidato el cliente elige "Me interesa" o "No avanzar" (con comentario). `POST /c/:token/opinion` crea una propuesta (fuente "Cliente") que actualiza la postulación al aprobarla (Entrevista cliente o Descartado "Rechazado por el cliente"); nada cambia hasta que alguien la aprueba en la Bandeja.
- Las columnas y tablas nuevas se crean solas al arrancar (`migrarSeguimiento`), sin `db:push`.

## Menú

- **Día a día:** **Inicio** (`#panel`, pestañas Hoy · Números · Búsquedas · Comercial: une el ex Panel y el Weekly; recruiters ven Hoy y Búsquedas), Bandeja de propuestas.
- **Operación:** Búsquedas, Candidatos (base de talento; el pipeline está en la ficha de cada búsqueda), Equipo (resumen de recruiters + "Editar equipo").
- **Negocio:** Clientes y leads, **Finanzas** (`#cobros`, pestañas Por cobrar · Cobradas · Comisiones · Gastos · Resultados · Todas las facturas; Resultados es el ex Unit economics).
- **Sistema:** Configuración (Usuarios y accesos, Objetivos, Conexiones, Historial, Calidad de datos, Papelera y respaldo, Pedidos de mejora; cada rol ve las suyas).
- Rutas viejas que siguen andando: `#weekly` y `#scorecard` → Inicio en la pestaña del weekly; `#economics` → Finanzas › Resultados; `#ajustes`, `#historial`, `#calidad`, `#conexiones`, `#mejoras` → su pestaña de Configuración.

## Vista de recruiter (`#recruiters`, `#recruiter/<nombre>`)

- Socios y Administradora ven el resumen del equipo y el detalle de cualquier recruiter; una recruiter ve solo su panel ("Mi panel").
- Indicadores por período (12 meses, año o todo): activas vs. capacidad, iniciadas, cerradas, éxito (cerradas / cerradas + canceladas), time to fill vs. equipo, días a la primera terna, presentados por búsqueda, tendencia mensual, funnel, clientes y comisiones.
- Comisiones de una recruiter: `GET /api/recruiter/comisiones` (`server/recruiters.js`) devuelve solo las suyas, sin montos de facturas. El nombre se resuelve contra Equipo (igual o mismo primer nombre).

## Convenciones de negocio

- Los montos se guardan en su moneda original. Para comparar, se convierte a dólares con el TC del mes de emisión (`tcFor`).
- Time to fill = días entre la fecha de inicio y la fecha de cierre.
- Las alertas del panel salen en tres casos: búsqueda activa sin actualizar hace más de 7 días, búsqueda abierta hace más de 60 días, y factura sin cobrar hace más de 30 días.

## Cómo trabajar los pedidos de mejora

Los pedidos están en la pantalla "Pedidos de mejora" (tabla `feedback`). Al terminar uno, marcalo "Hecho" y escribí una respuesta corta en lenguaje simple.

## Digest automático y Bandeja de propuestas

- `server/digest.js`: endpoints `/api/ingest/*` (protegidos con el secreto `INGEST_TOKEN`, para procesos automáticos) y `/api/propuestas` (socios y administradora).
  - `GET /api/ingest/contexto`: búsquedas, candidatos, clientes, leads y facturas pendientes en formato compacto.
  - `GET /api/ingest/google?desde=ISO`: mails y eventos nuevos de las cuentas @lemontalent.com (cuenta de servicio con delegación de dominio; secreto `GOOGLE_SA_JSON`).
  - `POST /api/ingest/propuestas`: carga propuestas. Cada una: `{ref, fuente, cuenta, fecha, resumen, evidencia, link, coleccion, registroId, op, datos}`. `op`: crear | actualizar | bitacora | minuta. Se deduplica por `ref`.
  - `PUT /api/ingest/cursor`: guarda la marca de la última lectura (config `digest`).
- Las propuestas **nunca** escriben solas: se aplican al aprobarlas en la pantalla "Bandeja de propuestas", con los permisos del usuario que aprueba.

## WhatsApp y LinkedIn (Unipile)

- `server/unipile.js`: secretos `UNIPILE_DSN` y `UNIPILE_API_KEY`. Cada usuario conecta sus cuentas desde la pantalla "Conexiones" (link de Unipile). El dueño de cada cuenta queda guardado en config `unipile`.
- `GET /api/ingest/mensajes?desde=ISO` (con `INGEST_TOKEN`): mensajes nuevos agrupados por chat. Nunca devuelve grupos. Con filtro "base", solo devuelve chats con teléfonos o nombres de candidatos y clientes del sistema.
- Es solo lectura: no se envían mensajes.

## Próximos pasos previstos

1. Digest diario de mails (Gmail API) que proponga actualizaciones de búsquedas, candidatos y facturas, para que un socio las apruebe.
2. Integración con Granola (API) para vincular minutas automáticamente por nombre de candidato o cliente.
3. WhatsApp: exportación semanal de chats o WhatsApp Business API.
4. Adjuntar CV a candidatos (Replit Object Storage).
