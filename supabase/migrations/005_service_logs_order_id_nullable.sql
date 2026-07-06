-- Fix: permitir NULL en service_logs.order_id para eventos de jornada (no ligados a orden)
-- Ejecutar en SQL Editor de Supabase

ALTER TABLE service_logs ALTER COLUMN order_id DROP NOT NULL;
