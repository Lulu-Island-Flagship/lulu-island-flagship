-- v0.4.1 (flujo de contratación) -- seed mínimo y aditivo de la vacante
-- pública "general".
--
-- Contexto: las migraciones 256-281 crearon toda la estructura del flujo de
-- contratación (positions, candidates, access_codes, sessions, etc.) pero
-- NINGUNA sembró una fila real en `positions`. Sin al menos una posición
-- con slug conocido y is_public = true, el nuevo punto de entrada público
-- (POST /api/hiring-flow/apply, que llama a submitStep1Application con
-- positionSlug fijo "general") fallaría siempre con PositionNotFoundError
-- -- el botón "Trabaje con nosotros" del footer no serviría para nada.
--
-- Esta migración NO reemplaza el trabajo pendiente de un panel de admin
-- para gestionar vacantes reales (fuera de este alcance) -- es únicamente
-- un placeholder aditivo para que el flujo funcione end-to-end mientras
-- ese panel no exista. ON CONFLICT (slug) DO NOTHING la hace segura de
-- re-ejecutar y no pisa una fila "general" que un admin ya haya editado a
-- mano después del seed inicial.
INSERT INTO positions (slug, title, description, is_public)
VALUES (
  'general',
  'Únete a nuestro equipo',
  'Aplicación general para unirte al equipo de Lulu Island Flagship Cleaning Services. Revisamos todas las aplicaciones y te contactaremos si hay una vacante que calce con tu perfil.',
  true
)
ON CONFLICT (slug) DO NOTHING;
