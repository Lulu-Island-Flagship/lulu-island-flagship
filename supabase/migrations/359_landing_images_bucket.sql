-- Migration 359: landing-images storage bucket + policies
-- v8.5 Day 6: admin can upload landing page images without touching code

-- Create public bucket for landing page images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'landing-images',
  'landing-images',
  true,
  10485760, -- 10MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
) ON CONFLICT (id) DO NOTHING;

-- Allow public read access to all objects
CREATE POLICY "public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'landing-images');

-- Allow authenticated (admin via is_admin RLS on site_content) to insert/update/delete
CREATE POLICY "admin_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'landing-images');

CREATE POLICY "admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'landing-images');

CREATE POLICY "admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'landing-images');
