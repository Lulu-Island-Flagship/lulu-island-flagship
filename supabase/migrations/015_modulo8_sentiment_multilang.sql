-- Migración: Módulo 8 — Renombrar expired_at y agregar palabras multi-idioma a sentiment

-- 1. Renombrar expired_at a review_window_expires_at en client_reviews
ALTER TABLE client_reviews RENAME COLUMN expired_at TO review_window_expires_at;

-- 2. Actualizar la función calculate_sentiment con palabras en español y francés
CREATE OR REPLACE FUNCTION calculate_sentiment(p_comment TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  positive_words TEXT[] := ARRAY[
    -- English
    'good','great','excellent','amazing','perfect','love','happy','satisfied',
    'recommend','clean','professional','punctual','friendly','thorough','spotless',
    'impressed','wonderful','fantastic','best','quality','awesome','outstanding',
    -- Español
    'bueno','buena','excelente','increíble','perfecto','perfecta','encanta','encantó',
    'feliz','satisfecho','satisfecha','recomiendo','limpio','limpia','profesional',
    'puntual','amable','amigable','minucioso','impecable','impresionado','impresionada',
    'maravilloso','maravillosa','fantástico','fantástica','mejor','calidad','genial',
    -- Français
    'bon','bonne','excellent','excellente','incroyable','parfait','parfaite','adore',
    'heureux','heureuse','satisfait','satisfaite','recommande','propre','professionnel',
    'professionnelle','ponctuel','ponctuelle','aimable','minutieux','minutieuse',
    'impeccable','impressionné','impressionnée','merveilleux','merveilleuse',
    'fantastique','meilleur','meilleure','qualité'
  ];
  negative_words TEXT[] := ARRAY[
    -- English
    'bad','terrible','awful','horrible','hate','angry','disappointed','dirty','late',
    'rude','unprofessional','poor','worst','broken','damaged','missed','incomplete',
    'rough','sloppy','careless','worst','disgusting','unhappy','frustrated','never',
    -- Español
    'malo','mala','terrible','horrible','odio','enojado','enojada','decepcionado',
    'decepcionada','sucio','sucia','tarde','grosero','grosera','improfesional',
    'pésimo','pésima','peor','roto','rota','dañado','dañada','perdido','perdida',
    'incompleto','incompleta','descuidado','descuidada','desordenado','desordenada',
    'nunca','descontento','descontenta','frustrado','frustrada',
    -- Français
    'mauvais','mauvaise','terrible','horrible','déteste','énervé','énervée',
    'déçu','déçue','sale','en retard','grossier','grossière','non professionnel',
    'non professionnelle','pire','cassé','cassée','endommagé','endommagée',
    'manqué','manquée','incomplet','incomplète','négligé','négligée','désordonné',
    'désordonnée','jamais','mécontent','mécontente','frustré','frustrée'
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
    IF comment_lower LIKE '%' || word || '%' THEN
      score := score + 0.15;
    END IF;
  END LOOP;
  
  FOREACH word IN ARRAY negative_words
  LOOP
    IF comment_lower LIKE '%' || word || '%' THEN
      score := score - 0.25;
    END IF;
  END LOOP;
  
  -- Clamp between -1 and 1
  RETURN GREATEST(-1.0, LEAST(1.0, score));
END;
$$;
