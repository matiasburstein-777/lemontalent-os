# Lemon Talent OS — instrucciones para Claude

Sistema interno de Lemon Talent (consultora de recruiting). Express + PostgreSQL, corre en Replit.
Producción: https://lemontalent-os.replit.app · Proyecto Replit: replit.com/@Tutebur1/lemon-talent-oszip

Contexto de negocio, decisiones y registro de migración: repo **matias-brain**,
`knowledge/personal/external-consulting/lemontalent/` (`_context.md`, `sistema-lemontalent-os.md`, `registro-migracion.md`).
Contexto funcional y reglas de permisos de la app: `replit.md`.

## Flujo de cambios

1. Editar en este repo y hacer push a `main` (GitHub es la fuente del código).
2. Para publicar: en el Shell de Replit correr `bash scripts/sync-desde-github.sh` y después **Republish**.
   Si la sesión tiene el navegador conectado, se puede hacer desde ahí; si no, avisarle a Matías que corra esos dos pasos.
3. Si Maga o el Agent de Replit cambiaron algo en Replit, antes de editar acá pedir que corran
   `bash scripts/subir-a-github.sh "descripción"` para no pisar esos cambios.

## Reglas

- **Nunca** subir datos reales: `data/`, `zipFile.zip`, backups ni exports. Están en `.gitignore`.
- Secretos solo en Replit Secrets (`DATABASE_URL`, `SESSION_SECRET`, `INGEST_TOKEN`, Unipile, Google). Nunca en el código.
- Permisos por rol (Socio / Administradora / Recruiter) se validan en el servidor, no solo en la UI.
- Cambios que afecten la migración desde planillas: anotarlos en `registro-migracion.md` del matias-brain.
- Fechas en hora local de Buenos Aires.
