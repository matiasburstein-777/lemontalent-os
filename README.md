# Lemon Talent OS

Sistema interno de Lemon Talent: búsquedas, candidatos, CRM, facturas y cobros, unit economics y pedidos de mejora.

## Puesta en marcha en Replit (unos 15 minutos)

1. **Crear el proyecto.** En replit.com, tocá **Create App → Import code or design → GitHub**. Si no usás GitHub todavía, creá un Repl de **Node.js** vacío y arrastrá todos los archivos de esta carpeta (incluida `data/`) al panel de archivos.
2. **Agregar la base de datos.** En el panel izquierdo, abrí **Database** y creá una base **PostgreSQL**. Replit crea solo el secreto `DATABASE_URL`.
3. **Cargar los secretos.** En **Secrets** (el ícono del candado), agregá:
   - `SESSION_SECRET`: cualquier texto largo y aleatorio.
   - `ADMIN_EMAIL`: tu email (será el primer socio).
   - `ADMIN_PASSWORD`: una contraseña de al menos 8 caracteres.
   - `ADMIN_NOMBRE`: tu nombre.
4. **Instalar y cargar los datos.** En la pestaña **Shell**, corré:
   ```
   npm install
   npm run setup
   ```
   Esto crea las tablas y carga búsquedas, candidatos, facturas, clientes, leads y el P&L desde 2023.
5. **Probar.** Tocá **Run**, abrí la vista previa e ingresá con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
6. **Publicar.** Tocá **Deploy → Autoscale** para tener una URL fija. Antes de publicar, copiá los mismos secretos en el deploy.
7. **Invitar al equipo.** Entrá a **Equipo y accesos → Nuevo usuario**. Pau va como **Socio**; las recruiters, como **Recruiter**.
8. **Borrar los datos crudos.** Una vez cargados, eliminá la carpeta `data/`: tiene información sensible y ya no hace falta.

## Para que Maga lo mejore

- Invitala al proyecto de Replit (**Invite → Can edit**). Ojo: con acceso al proyecto puede ver toda la base, incluida la facturación.
- Para cambiar algo, le pide al **Agent** de Replit en lenguaje natural. Por ejemplo: "en Candidatos agregá un campo para el CV". El archivo `replit.md` le da al agente el contexto del sistema y las reglas de permisos.
- Los pedidos del equipo se cargan desde el botón **Sugerir mejora** y se siguen en **Pedidos de mejora**.
- Replit guarda puntos de control: si un cambio rompe algo, se vuelve atrás desde el historial del Agent.

## Respaldo en GitHub (recomendado)

En Replit, abrí **Git → Connect to GitHub** y creá un repositorio **privado**. La carpeta `data/` queda fuera del repo por `.gitignore`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run start` | Levanta el servidor (puerto 5000). |
| `npm run db:push` | Aplica cambios de `shared/schema.js` a la base. |
| `npm run db:seed` | Vuelve a cargar `data/` sin pisar lo existente. |
