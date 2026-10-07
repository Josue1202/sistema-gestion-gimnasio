-- ============================================================
--  Base de datos para Evolution API (WhatsApp Baileys).
--  Se ejecuta una sola vez, en el primer arranque del contenedor.
--  (El esquema del gimnasio vive en la base por defecto: POSTGRES_DB = gym)
-- ============================================================

SELECT 'CREATE DATABASE evolution'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution')\gexec
