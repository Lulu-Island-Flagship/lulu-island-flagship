-- Bucket privado para CVs y documentos de candidatos (información
-- personal sensible -- nunca público, solo staff con rol recruiter/hr_admin
-- vía RLS + signed URL desde el panel admin de aplicaciones).
INSERT INTO storage.buckets (id, name, public)
VALUES ('candidate-documents', 'candidate-documents', false)
ON CONFLICT (id) DO NOTHING;
