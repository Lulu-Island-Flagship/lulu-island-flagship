-- Migración: Módulo 8 — calculate_sentiment con word boundaries (regex) + índice review_window_expires_at

-- 0. Rename faltante detectado en primer db reset real (E0-C1): el código de la app
--    usa review_window_expires_at pero la tabla se creó con expired_at (010) y el
--    rename se hizo a mano en la base vieja, nunca como migración. Idempotente:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_reviews' AND column_name = 'expired_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_reviews' AND column_name = 'review_window_expires_at'
  ) THEN
    ALTER TABLE client_reviews RENAME COLUMN expired_at TO review_window_expires_at;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_reviews' AND column_name = 'review_window_expires_at'
  ) THEN
    ALTER TABLE client_reviews ADD COLUMN review_window_expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- 1. Índice en review_window_expires_at para queries de ventana
CREATE INDEX IF NOT EXISTS idx_client_reviews_window_expires ON client_reviews(review_window_expires_at);

-- 2. Función calculate_sentiment con word boundaries (\y en PostgreSQL regex)
CREATE OR REPLACE FUNCTION calculate_sentiment(p_comment TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  positive_words TEXT[] := ARRAY[
    'good','great','excellent','amazing','perfect','love','happy','satisfied',
    'recommend','clean','professional','punctual','friendly','thorough','spotless',
    'impressed','wonderful','fantastic','best','quality','awesome','outstanding',
    'bueno','buena','excelente','increible','perfecto','perfecta','encanta','encanto',
    'feliz','satisfecho','satisfecha','recomiendo','limpio','limpia','profesional',
    'puntual','amable','amigable','minucioso','impecable','impresionado','impresionada',
    'maravilloso','maravillosa','fantastico','fantastica','mejor','calidad','genial',
    'bon','bonne','excellent','excellente','incroyable','parfait','parfaite','adore',
    'heureux','heureuse','satisfait','satisfaite','recommande','propre','professionnel',
    'professionnelle','ponctuel','ponctuelle','aimable','minutieux','minutieuse',
    'impeccable','impressionne','impressionnee','merveilleux','merveilleuse',
    'fantastique','meilleur','meilleure','qualite'
  ];
  negative_words TEXT[] := ARRAY[
    'bad','terrible','awful','horrible','hate','angry','disappointed','dirty','late',
    'rude','unprofessional','poor','worst','broken','damaged','missed','incomplete',
    'rough','sloppy','careless','disgusting','unhappy','frustrated','never',
    'malo','mala','terrible','horrible','odio','enojado','enojada','decepcionado',
    'decepcionada','sucio','sucia','tarde','grosero','grosera','improfesional',
    'pesimo','pesima','peor','roto','rota','danado','danada','perdido','perdida',
    'incompleto','incompleta','descuidado','descuidada','desordenado','desordenada',
    'nunca','descontento','descontenta','frustrado','frustrada',
    'mauvais','mauvaise','terrible','horrible','deteste','enerve','enervee',
    'decu','decue','sale','en retard','grossier','grossiere','non professionnel',
    'non professionnelle','pire','casse','cassee','endommage','endommagee',
    'manque','manquee','incomplet','incomplete','neglige','negligee','desordonne',
    'desordonnee','jamais','mecontent','mecontente','frustre','frustree'
  ];
  word TEXT;
  score DOUBLE PRECISION := 0;
  comment_lower TEXT;
BEGIN
  IF p_comment IS NULL OR LENGTH(TRIM(p_comment)) = 0 THEN
    RETURN 0;
  END IF;
  
  comment_lower := LOWER(p_comment);
  
  FOREACH word IN ARRAY positive_words
  LOOP
    -- Word boundary: \yword\y en PostgreSQL regex
    IF comment_lower ~ ('\y' || word || '\y') THEN
      score := score + 0.15;
    END IF;
  END LOOP;
  
  FOREACH word IN ARRAY negative_words
  LOOP
    IF comment_lower ~ ('\y' || word || '\y') THEN
      score := score - 0.25;
    END IF;
  END LOOP;
  
  -- Clamp between -1 and 1
  RETURN GREATEST(-1.0, LEAST(1.0, score));
END;
$$;
