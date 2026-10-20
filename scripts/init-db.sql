-- Database initialization script
-- Runs once when the PostgreSQL container is first created

-- Enable pgcrypto for gen_random_uuid() (available in PG 14+ natively, but belt-and-suspenders)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create a dedicated schema for the application
-- This keeps our tables separated from pg_catalog and any future extensions
CREATE SCHEMA IF NOT EXISTS ucss;

-- Grant all privileges on the schema to our app user
GRANT ALL PRIVILEGES ON SCHEMA ucss TO ucss_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA ucss GRANT ALL ON TABLES TO ucss_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA ucss GRANT ALL ON SEQUENCES TO ucss_user;
