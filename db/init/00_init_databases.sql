-- ============================================================
--  Bases de datos separadas para n8n y Evolution API.
--  Se ejecuta una sola vez, en el primer arranque del contenedor.
--  (El esquema del gimnasio vive en la base por defecto: POSTGRES_DB = gym)
-- ============================================================

SELECT 'CREATE DATABASE n8n'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec

SELECT 'CREATE DATABASE evolution'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution')\gexec
