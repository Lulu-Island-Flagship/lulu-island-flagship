-- Agrega square_feet_declared a quotes para el flujo BC Assessment como columna vertebral.
-- El cliente puede declarar un área diferente a la del registro oficial.
-- El precio SIEMPRE se calcula con square_feet (oficial); square_feet_declared es solo informativo para factura.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS square_feet_declared INTEGER;
