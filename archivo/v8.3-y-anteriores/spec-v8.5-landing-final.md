# v8.5 — Landing Page Final: Qué SÍ, Qué NO, y Por Qué

> **Fecha:** 2026-08-05
> **Versión:** Final v1.1 — incluye constraint de cero fotos + admin-editable text
> **Reemplaza:** `spec-v8.4-landing-vip-analysis.md`
> **Propósito:** Especificación definitiva del landing page público de Lulu Island Flagship.

---

## 1. Fundamento: Lo que el dueño estableció

Cinco hechos que gobiernan todo lo que sigue:

| # | Hecho | Consecuencia para el site |
|---|-------|--------------------------|
| 0 | **Cero fotos en lanzamiento. Preparado para fotos futuras.** El admin podrá subir imágenes desde su consola cuando estén disponibles — sin tocar código. En el lanzamiento, el diseño funciona con texto, color y espacio. | El landing tiene «image slots» predefinidos que permanecen vacíos (colapsados) hasta que el admin sube una imagen. Sin placeholders. Sin «próximamente». |
| 1 | **No se promete «same team, every time».** Enfermedad, renuncia, vacaciones = promesa rota. Lo que se garantiza es resultado consistente mediante perfiles documentados del hogar + protocolos estandarizados. | El copy dice «documented home profile» y «consistent result». Nunca «same faces». |
| 2 | **Precio fijo por servicio, no por hora.** El cliente nunca ve horas. BC Assessment provee el tamaño real de la propiedad. El cotizador devuelve precio firme, no rango. | El hero es un campo de dirección + botón «See your price». El precio es el producto. |
| 3 | **VIP por precio, no por segmento.** No se decide si el cliente es «mass-affluent» o «UHNW». El precio filtra solo. Quien puede pagar, se queda. | No hay dos CTAs, dos lands, ni dos caminos. Un solo flujo. |
| 4 | **Textos editables por admin sin tocar código.** El dueño o admin debe poder cambiar cualquier texto del landing desde una consola web. Sin dependencia de programador para ajustar copy. | Todo el contenido del landing se sirve desde una tabla `site_content` en Supabase, con fallback a `messages/en.json`. |

---

## 2. Principios rectores del diseño

Cada decisión de copy, layout y funcionalidad en este documento se evaluó contra al menos uno de estos tres principios:

- **Principio de rentabilidad:** ¿Esto protege el margen o lo expone?
- **Principio de evidencia:** ¿Esto se respalda con datos, fotos, o hechos — o es solo una promesa?
- **Principio de profesionalismo:** ¿El tono es de igual a igual o de servilismo?

### 2.1 Restricción de diseño: cero fotos en lanzamiento, slots preparados

- En lanzamiento: cero fotos, cero ilustraciones, cero video.
- El único elemento gráfico es el ícono Ship de lucide-react en el header.
- El diseño funciona sin imágenes: tipografía, espacio blanco, paleta, jerarquía de texto.
- **Preparado para el futuro:** el landing tiene 3 «image slots» predefinidos (ver sección 8.6). Cada slot es un contenedor colapsado que permanece invisible hasta que el admin sube una imagen desde su consola. Cuando la imagen existe, el slot se expande y la muestra en la posición y con el estilo predefinidos. Sin tocar código.

---

## 3. Qué SÍ se construye

### 3.1 Hero Section

```
┌──────────────────────────────────────────────────┐
│                                                  │
│   Lulu Island Flagship                           │
│   Residential Home Care — Richmond, BC           │
│                                                  │
│   Fixed-price home care.                         │
│   Based on your property. Verified with photos.  │
│   No hourly billing. No disputes.                │
│                                                  │
│   [  Enter your address  ]  [  See your price  ] │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Por qué sí:**
- Sin headline retórico. El valor está en el campo de dirección y el botón.
- «Fixed-price» — la palabra más importante. Comunica certeza, no estimación.
- «Based on your property» — BC Assessment sin mencionarlo. El dato es externo, no negociable.
- «Verified with photos» — la evidencia es parte del producto, no un extra post-venta.
- «No hourly billing. No disputes.» — cierra dos objeciones en 6 palabras.
- Sin «same team». Sin «guaranteed». Sin «satisfaction». Promesas mínimas, evidencia máxima.

**Por qué no las alternativas:**
- «The same trusted team, every time» → promesa frágil (baja por enfermedad = incumplimiento)
- «Your home, cared for. Not just cleaned.» → retórica vacía sin foto que la respalde
- «Get Your Quote» → «quote» es provisorio; «price» es definitivo
- Doble CTA («Get Estimate» + «Request Consultation») → fragmenta al visitante; el sistema segmenta solo por dirección

### 3.2 How It Works

```
HOW IT WORKS

1. Enter your address. We calculate your price
   using your property's actual data.

2. A team arrives. They follow your home's
   documented care profile. Every preference
   recorded. Every surface treated to spec.

3. You receive time-stamped photos of every
   completed area. Review them. If something
   doesn't match, we fix it — backed by evidence,
   not opinions.

4. You pay. Same price. Every time. Reschedule
   or cancel anytime.
```

**Por qué sí:**
- Sin íconos, sin columnas, sin tarjetas. Texto plano con espacio blanco.
- Cada paso es una acción del sistema, no una promesa de la empresa.
- «Backed by evidence, not opinions» — establece el principio de resolución de disputas.
- «Same price. Every time.» — cierra la ansiedad de «¿me cobrarán más la próxima vez?»

**Por qué no las alternativas:**
- Tarjetas con íconos (Shield, Users, Star) → genérico, SaaS, no diferencia
- Diagrama de 4 pasos con ilustraciones → requiere diseño que no tienes; el texto funciona sin él
- «White Glove Process» o «The Lulu Standard» → naming pretencioso que no añade información

### 3.3 What's Included / What's Not

```
WHAT'S INCLUDED — EVERY SERVICE
All rooms, floors, surfaces, fixtures, appliances.
Kitchen, bathrooms, living areas, bedrooms.
Eco-certified products. HEPA-filtered equipment.

WHAT'S NOT
Biohazard, mold remediation, pest infestation,
construction debris, hoarding conditions.
These require licensed specialists. We'll refer you.

IF SOMETHING BREAKS
We're insured. We document pre-existing conditions
during your first service. If we cause damage,
we cover it — no questions.
```

**Por qué sí:**
- «What's not» es explícito. Protege el margen excluyendo trabajos de alto costo y alto riesgo.
- «If something breaks» es responsabilidad clara sin prometer el mundo.
- Derivado directamente del Plan V4 y la Crítica de Dignidad (nivel 5 = rechazo, no servicio).
- «We document pre-existing conditions» — el sistema v8.3 ya tiene esta capacidad.

**Por qué no las alternativas:**
- «100% Satisfaction Guarantee» → liability ilimitado; un VIP puede objetar una mota de polvo
- «If you're not happy, we re-clean free» → sin evidencia vinculante, es un cheque en blanco
- Omitir exclusiones → el cliente asume que todo está cubierto; la primera disputa por moho te cuesta el negocio

### 3.4 Our Standards

```
OUR STANDARDS

Photo-verified completion. Every area photographed
before we leave. You see what we did.

Wellness-screened teams. Every member checked
before dispatch. No one arrives exhausted or unwell.

Chemical safety protocol. Products are matched
to surfaces and never cross-contaminated. Your
indoor air stays safe.

Documented home profile. Your preferences,
surfaces, and instructions live in your home's
care record. No repeating yourself. No surprises.
```

**Por qué sí:**
- Derivado directamente del sistema v8.3: photo evidence, wellbeing monitoring, poka-yoke químico, home profiles.
- Cada bullet es un hecho comprobable, no un adjetivo.
- Sin íconos. Sin «Built Different». Sin entusiasmo. Hechos.
- «No repeating yourself» — beneficio concreto que ningún competidor ofrece.

**Por qué no las alternativas:**
- «Verified & Trained», «Same Team Always», «Premium Guarantee» → genérico; lo dicen todos los competidores
- Mencionar explícitamente «poka-yoke» o «chemical lockout» → jerga interna que el cliente no necesita
- «We use AI» o «smart technology» → el cliente VIP no compra tecnología; compra resultados

### 3.5 FAQ

```
WHAT IF I'M NOT SATISFIED?
If the time-stamped completion photos don't match
what you see, we return within 24 hours and correct
the specific areas — at no charge. If they match,
the service is considered complete. Either way,
the evidence decides.

WHAT IF THE TEAM CHANGES?
Your home has a documented care profile. Any trained
team member can deliver the same result. You may not
always see the same faces. You will always see the
same outcome.

WHAT IF I NEED TO CANCEL?
Cancel or reschedule anytime up to 48 hours before
your service at no charge. Within 48 hours, a $50
rescheduling fee applies. Same-day cancellations
are billed at 50%.

WHO HAS ACCESS TO MY KEYS OR ALARM CODE?
Stored encrypted. Accessed only by the dispatched
team lead on service day. Logged. Never shared.
All staff sign confidentiality agreements.

ARE YOU INSURED?
Yes. Liability coverage. WorkSafeBC registered.
Bonded. Documentation available upon request.
```

**Por qué sí:**
- La garantía es condicional a la evidencia fotográfica. Justa para ambas partes.
- «The evidence decides» — principio rector repetido. Profesional, no servil.
- La política de cancelación tiene dientes: protege contra abuso VIP.
- «Same result, not same faces» — honesto. No promete lo que no puede cumplir.
- Tono directo. Sin «¡Por supuesto!» ni «¡Nos encantaría!». El VIP quiere certeza, no entusiasmo.
- Las preguntas son las que un cliente con patrimonio realmente hace (llaves, alarmas, NDAs, cancelaciones).

**Por qué no las alternativas:**
- Garantía incondicional → riesgo financiero ilimitado
- «Same team, every time — guaranteed» → no es operativamente sostenible
- Política de cancelación sin fee → invita al abuso de último minuto
- FAQ con preguntas genéricas («¿Aceptan tarjeta?») → no diferencian; no abordan miedos reales

### 3.6 Flujo de Cotización

```
Visitante ingresa dirección
        │
        ▼
Sistema consulta BC Assessment → obtiene sq ft, tipo, año
        │
        ├─ ≤4,000 sq ft, residencial
        │       ▼
        │   Muestra: «Your price: $X»
        │   Incluye: desglose de qué cubre
        │   Botón: «Book now →»
        │   → Auth → Checkout (Stripe)
        │
        └─ >4,000 sq ft o comercial
                ▼
            «Your home deserves a personalized assessment.
             Our estate manager will contact you within
             4 hours. Or call us: (604) XXX-XXXX»
```

**Por qué sí:**
- El precio se calcula con datos reales de BC Assessment, no con lo que el cliente declara.
- Sin wizard de 5 pasos para el flujo estándar. BC Assessment ya sabe los baños y las habitaciones.
- La rama >4,000 sq ft no elige el cliente — el sistema decide basado en datos objetivos.
- Un solo punto de entrada (campo de dirección). Sin decidir «qué tipo de cliente soy».

**Por qué no las alternativas:**
- Wizard de 5 pasos preguntando «¿cuántos baños?» → BC Assessment ya lo sabe; es fricción innecesaria
- Dos CTAs en el hero → fragmenta; el sistema segmenta mejor que el usuario
- «Get a quote» → quote es estimado; price es definitivo

### 3.7 Footer

```
Lulu Island Flagship
Residential Home Care
Richmond, BC
(604) XXX-XXXX
hello@luluislandflagship.ca

Services · Standards · FAQ · About
Terms · Privacy · Cancellation Policy
EN | 中文 | FR
Team Portal
```

**Por qué sí:**
- Teléfono visible — legitimidad para servicios que entran a tu casa
- «Residential Home Care» consistente con el posicionamiento
- Team Portal en gris claro, discreto — no compite con navegación de cliente
- Enlaces legales requeridos

**Por qué no las alternativas:**
- «Cleaning Services» → muy genérico, no refleja posicionamiento premium
- «Work With Us» en footer principal → mezcla reclutamiento con experiencia de cliente

---

## 4. Qué NO se construye (y por qué)

### 4.1 Elementos de copy

| Elemento rechazado | Por qué NO |
|--------------------|------------|
| «The same trusted team, every time» | Promesa frágil. Una baja por enfermedad = incumplimiento. Reemplazado por «documented home profile» + «consistent result». |
| «Takes less than 90 seconds» | Velocidad no es valor para cliente VIP. Velocidad comunica «app barata». Reemplazado por «See your price» sin promesa de tiempo. |
| «100% Satisfaction Guarantee» | Liability ilimitado. Un cliente VIP con casa de $4M puede objetar cualquier cosa. Reemplazado por garantía condicional a foto-evidencia. |
| «Verified & Trained» | Mínimo legal en BC. No diferencia. Reemplazado por estándares específicos del sistema v8.3. |
| «Premium Guarantee» | Vago. No significa nada sin mecanismo de resolución. Reemplazado por «evidence decides». |
| Cualquier variante de «best», «#1», «top-rated» | Sin evidencia que lo respalde. Afirmaciones vacías destruyen credibilidad. |
| «Cheap», «affordable», «discount», «$X OFF» | Incompatible con posicionamiento de precio fijo premium. |
| «Estate Care», «Private Residence Care», «Home Stewardship» | El dueño no pidió cambiar la categoría. «Residential Home Care» es suficiente sin pretensión. |
| «Ritual ancestral», «conservador de arte», «Wabi-Sabi» | Lenguaje pretencioso que el cliente de Richmond (construcción, tech, medicina) lee como justificación de sobreprecio. |
| «Wok Kitchen Specialists» como bandera | Reduce la marca a un estereotipo étnico. La competencia técnica en superficies específicas se menciona en /services, no en el landing. |

### 4.2 Elementos de diseño

| Elemento rechazado | Por qué NO |
|--------------------|------------|
| Íconos (Shield, Star, Users, Clock) | Genéricos. SaaS. No comunican nada que el texto no comunique mejor. Se eliminan de page.tsx. |
| Tarjetas con sombra y bordes redondeados | Layout de startup. El lujo usa texto plano con espacio blanco. |
| Columnas de 3 (trust signals actuales) | La confianza no se comunica en bullets paralelos. Se comunica en prosa secuencial. |
| Dark mode | Ilegible para 45-70 años. El target de Richmond no tiene 25. |
| Paleta nueva con dorados o nueva tipografía serif | El problema no es el color ni la fuente. La paleta Powder Sky es funcional y accesible. Cambiarla sin evidencia de que mejora conversión es premature optimization. |
| Video background en hero | Requiere producción que no existe. Sin fotos, menos aún video. |
| WhatsApp flotante | Distrae del flujo principal. El teléfono está en el footer. |
| Animaciones scroll-triggered | Añaden complejidad sin evidencia de mejorar conversión. |

### 4.3 Elementos de contenido

| Elemento rechazado | Por qué NO |
|--------------------|------------|
| Testimonios (sin tenerlos reales) | Inventar testimonios es fraude. Placeholders vacíos comunican «no tengo clientes». Mejor omitir hasta tener 3 reales con nombre + barrio. |
| Fotos del equipo | No existen aún. Cuando existan, van en /about, no en el landing. |
| Blog | Sin contenido aún. Cuando exista, va en /journal o /guides. |
| «Flagship Program» o membership tiers | Prematuro. Requiere 20+ clientes recurrentes para tener sentido. |
| Landing pages por vecindario | Mes 3+, cuando el site base convierta. |
| Google Ads | Mes 2+, cuando haya fotos reales y testimonios. |
| Video promocional | Requiere producción que no existe. |
| Cualquier imagen placeholder («foto próximamente») | Un placeholder comunica «no tengo nada que mostrar». Peor que no tener foto. |

### 4.4 Elementos de plataforma

| Elemento rechazado | Por qué NO |
|--------------------|------------|
| Migrar a WordPress, Webflow, o cualquier otro stack | El stack Next.js + Supabase + Stripe funciona. No hay razón técnica ni de negocio para migrar. |
| Chatbot LLM | Riesgo de alucinaciones peligrosas («sí, mezcle amoníaco y cloro»). El propio v8.3 lo rechazó (B.13). |
| AR, wearables, IoT en el site público | Rechazado en Mejoras v0.2 (C.10, C.11). No es momento. |
| Single-page architecture | SEO local requiere páginas separadas por servicio y vecindario (mes 3+). |

---

## 5. Mecanismos de rentabilidad integrados en el site

Cada decisión de este documento protege el margen:

| Mecanismo | Dónde está | Cómo protege el margen |
|-----------|------------|----------------------|
| Precio fijo, no por hora | Hero + Flujo de cotización | Ineficiencia operativa = costo tuyo. Pero también tu incentivo para ser eficiente. |
| BC Assessment como fuente de datos | Flujo de cotización | Elimina «mi casa es más pequeña de lo que dice tu sistema». Dato externo, no negociable. |
| Foto-evidencia vinculante | FAQ (garantía condicional) | Elimina disputas subjetivas. Re-servicio solo si la evidencia falla. |
| Cancelación con fee escalonado | FAQ (cancelación) | 48h gratis, <48h $50, same-day 50%. Protege contra abuso VIP de último minuto. |
| Exclusión explícita de biohazard/mold/plagas | What's Not | Elimina trabajos de alto costo y alta responsabilidad. Derivado del Plan V4. |
| Wellness screening | Our Standards | Reduce ausentismo, errores en campo, rotación — los tres mayores costos ocultos. |
| Perfil documentado del hogar | Our Standards + FAQ | Reduce tiempo de onboarding de nuevos team members. Cualquier trained member ejecuta. |
| Sin «same face» prometido | FAQ (team changes) | Elimina exposición a «me prometiste a María». Prometes resultado, no persona. |

---

## 6. Lo que NO cambia (elementos existentes que se preservan)

| Elemento | Estado |
|----------|--------|
| Stack Next.js 14 + Tailwind + TypeScript | Intacto |
| Supabase Auth + PostgreSQL | Intacto |
| Stripe (Módulo 2) | Intacto |
| Paleta Powder Sky (`src/design/tokens.ts`) | Intacta. Sin cambios. |
| Tipografía Inter | Intacta |
| Multi-idioma EN/ZH/FR (next-intl) | Intacto |
| Sistema v8.3 completo (backend) | Intacto |
| Motor de precios (`src/lib/pricing.ts`) | Intacto, se conecta a BC Assessment |
| Cotizador de 5 pasos | Se reemplaza en flujo estándar por resultado directo desde dirección; se preserva como fallback |
| Feature flags (M2-M5) | Apagados. No se tocan. |
| Crons y seguridad operacional | Intactos |
| Plan V4 de precios + Crítica de Dignidad | Intactos. Referenciados en What's Not y FAQ |
| Ícono Ship (header) | Intacto. Único elemento gráfico del landing. |
| Header existente (Sign In, Sign Up, LanguageSelector) | Intacto. Solo cambia el subtítulo: «Cleaning Services» → «Residential Home Care». |

---

## 7. Mapa de color completo

### 7.1 Tokens usados en el landing

| Token | Hex | Uso en landing |
|-------|-----|----------------|
| `--brand-navy` | #2E5C8A | Botón CTA, números en How It Works, títulos de sub-sección en What's Included/Not, FAQ hover |
| `--brand-navyLight` | #3E6D9E | Hover del botón CTA y links |
| `--brand-waveBlue` | #3A6E9E | Subtítulo del header, títulos de sección (HOW IT WORKS, OUR STANDARDS), subtexto del botón, links del footer |
| `--brand-ink` | #1F2E3D | Todo el texto de cuerpo, nombre en header, footer |
| `--brand-ice` | #EAF4FB | Fondo de secciones alternas (What's Not, FAQ), borde de header y footer |
| `--brand-white` | #FFFFFF | Fondo de hero, How It Works, Our Standards; fondo general |

### 7.2 Tokens NO usados en el landing

| Token | Por qué no |
|-------|------------|
| `--brand-gold` (#E3AAB8) | Era el badge «Serving Richmond…» y acentos. Sin badge ni íconos decorativos, no tiene función en landing. Permanece en admin/empleado. |
| `--brand-goldDark` (#772238) | Era el relleno de estrella. Sin estrella, sin este color en landing. |

### 7.3 Mapa visual por sección

```
HEADER    bg-white · border-bottom ice
          Ship ícono (navy) · «Lulu Island Flagship» (ink) · «Residential Home Care» (waveBlue)

HERO      bg-white
          «Lulu Island Flagship» (ink, bold, 2xl/3xl)
          «Residential Home Care — Richmond, BC» (waveBlue, sm)
          Proposición (ink, md/lg, max-w-prose)
          Campo dirección: borde ice, foco navy, texto ink, bg white
          Botón CTA: bg-navy, texto white, hover bg-navyLight, rounded-md
          Hint (waveBlue, xs)

HOW IT    bg-white
WORKS     Título sección (waveBlue, xs, uppercase, tracking-wide)
          Números (navy, lg, bold)
          Texto (ink, base, leading-relaxed)

INCLUDED  bg-ice
/ NOT     Títulos sub-sección (navy, xs, uppercase)
          Texto (ink, base)

STANDARDS bg-white
          Título sección (waveBlue, xs, uppercase)
          Nombre estándar (ink, base, bold)
          Descripción (ink, base, normal)

FAQ       bg-ice
          Título sección (navy, xs, uppercase)
          Pregunta (ink, base, bold)
          Respuesta (ink, base, leading-relaxed)

FOOTER    bg-white · border-top ice
          «Lulu Island Flagship» (ink, semibold)
          Tagline (waveBlue, xs)
          Links (waveBlue, xs, hover navy)
          «Team Portal» (gray-400, xs)
```

---

## 8. Sistema de contenido editable por admin

### 8.1 Tabla `site_content` (Supabase)

```sql
CREATE TABLE site_content (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_write" ON site_content FOR ALL
  TO authenticated USING (is_admin());
CREATE POLICY "public_read" ON site_content FOR SELECT
  TO anon USING (true);
```

### 8.2 API endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `GET /api/content/landing` | Público | Devuelve JSON `{ key: value }` para todas las keys del landing. Sin auth. Cacheable ISR 60s. |
| `PUT /api/admin/content` | Admin | Body: `{ key, value }`. Actualiza una key. Requiere auth admin. |
| `GET /api/admin/content` | Admin | Devuelve todas las keys con sus valores. Para panel de edición. |

### 8.3 Panel de edición (admin UI)

Ruta: `/[locale]/admin/content`

Interfaz: lista de todas las keys del landing. Cada una muestra:
- Label descriptivo (qué parte del landing controla)
- Textarea con el valor actual
- Botón «Save» por key (optimistic UI: verde al guardar, rojo si falla)

### 8.4 Keys del landing y sus defaults

Los defaults viven en `messages/en.json`. Si una key no existe en `site_content`, el landing usa el default de next-intl. Esto permite lanzar con la tabla vacía — el copy inicial sale de `messages/en.json`.

| Key | Controla |
|-----|----------|
| `hero.title` | «Lulu Island Flagship» |
| `hero.subtitle` | «Residential Home Care — Richmond, BC» |
| `hero.proposition` | Las 3 líneas de propuesta de valor |
| `hero.cta` | Texto del botón «See your price» |
| `hero.placeholder` | Placeholder del campo de dirección |
| `hero.hint` | Subtexto «Takes about 90 seconds» |
| `how.title` | «HOW IT WORKS» |
| `how.step1` … `how.step4` | Los 4 pasos |
| `included.title` | «WHAT'S INCLUDED — EVERY SERVICE» |
| `included.body` | Texto de inclusiones |
| `not_included.title` | «WHAT'S NOT» |
| `not_included.body` | Texto de exclusiones |
| `breaks.title` | «IF SOMETHING BREAKS» |
| `breaks.body` | Texto de roturas |
| `standards.title` | «OUR STANDARDS» |
| `standards.1.title` … `standards.4.body` | Los 4 estándares |
| `faq.title` | Título de sección FAQ |
| `faq.q1` … `faq.a5` | 5 preguntas + 5 respuestas |
| `footer.tagline` | «Residential Home Care» |

### 8.5 Cómo consume el landing

El componente `LandingContent` (server component con ISR):

1. `fetch('/api/content/landing')` — en build time (ISR revalidate: 60s)
2. Para cada key, si existe en la respuesta → usar ese valor
3. Si no existe → usar `t('hero.title')` de next-intl (messages/en.json)
4. Renderizar con los valores resueltos

Esto permite:
- Lanzar sin poblar la tabla (todo funciona con defaults)
- El admin edita gradualmente lo que necesita
- El cambio aparece en máximo 60 segundos (ISR)

---

### 8.6 Image Slots — fotos subidas por admin sin tocar código

**Dónde se almacenan:** Supabase Storage bucket `landing-images`. Accessible públicamente para lectura (CDN), restringido a admin para escritura.

**Cómo funciona:** El landing page tiene 3 «slots» predefinidos. Cada slot es una key en `site_content` cuyo valor es la URL pública de una imagen en Supabase Storage.

- **Slot vacío (default):** la key no existe o su valor es `""` → el slot no renderiza nada. Cero espacio ocupado. Cero layout shift.
- **Slot ocupado:** la key contiene una URL → el slot renderiza la imagen en la posición y con el estilo predefinidos para ese slot.

El admin sube la imagen desde el panel `/admin/content`:
1. Selecciona el slot (dropdown: «Hero background», «Section divider 1», «Section divider 2»)
2. Elige archivo de imagen (drag & drop o file picker)
3. El sistema la sube a Supabase Storage, obtiene la URL pública, y guarda la key en `site_content`
4. El cambio se refleja en máximo 60 segundos (ISR)

**Los 3 image slots:**

| Slot key | Posición en landing | Estilo cuando está activo | Tamaño recomendado |
|----------|-------------------|--------------------------|-------------------|
| `image.hero` | Hero section — como fondo detrás del texto y el campo de dirección | `bg-cover bg-center` con overlay semitransparente oscuro (`bg-black/30`) sobre la imagen para legibilidad del texto blanco/navy. La imagen llena el ancho completo. Altura: 70vh | 1920×1080 px |
| `image.divider1` | Entre «How It Works» y «What's Included» | Imagen full-width, 300px de alto, `object-cover`. Sin overlay. Separa secciones con una pausa visual. | 1920×600 px |
| `image.divider2` | Entre «Our Standards» y «FAQ» | Igual que divider1: full-width, 300px alto, `object-cover`. | 1920×600 px |

**API adicional para image slots:**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `POST /api/admin/content/image` | Admin | Body: `{ slot, file }`. Sube la imagen a Supabase Storage y guarda la URL en `site_content`. |
| `DELETE /api/admin/content/image` | Admin | Body: `{ slot }`. Elimina la imagen del storage y borra la key de `site_content`. |

**Panel admin — sección Images:**

Debajo de la lista de keys de texto, una sección «Landing Images» con 3 cards, una por slot. Cada card muestra:
- Nombre del slot («Hero background», «Section divider 1», «Section divider 2»)
- Vista previa de la imagen actual (thumbnail) o «No image» si está vacío
- Botón «Upload» (abre file picker)
- Botón «Remove» (solo visible si hay imagen)

**Comportamiento del landing:**

El componente `LandingContent` consulta las keys `image.hero`, `image.divider1`, `image.divider2` junto con el resto del contenido. Para cada una:
- Si tiene valor → renderiza `<Image>` (next/image) en la posición correspondiente con el estilo predefinido
- Si no tiene valor → no renderiza nada

Esto garantiza que:
- El lanzamiento funciona sin fotos (todos los slots vacíos)
- El admin puede añadir una foto al hero cuando tenga una — sin tocar page.tsx
- Puede añadir las otras dos después — sin tocar page.tsx
- Si mañana quiere quitar una foto, la borra del panel y el slot colapsa

---

## 9. Plan de construcción (9 días)

| Día | Qué se hace | Archivos afectados |
|-----|-------------|-------------------|
| 1 | Hero: reemplazar H1/H2/CTA actual por campo de dirección + «See your price» + 3 líneas. Eliminar íconos y badge del hero. | `page.tsx`, `messages/en.json` |
| 2 | Eliminar las 3 tarjetas de trust signals. Crear secciones «How it works» (4 pasos texto) + «Our Standards» (4 bullets). | `page.tsx`, `messages/en.json` |
| 3 | Añadir «What's included / What's not / If something breaks». | `page.tsx`, `messages/en.json` |
| 4 | Añadir FAQ (5 preguntas + respuestas). | Nuevo `FaqSection.tsx`, `messages/en.json` |
| 5 | Crear tabla `site_content` en Supabase + endpoints `GET /api/content/landing` y `PUT /api/admin/content`. | Migración SQL, `src/app/api/content/`, `src/app/api/admin/content/` |
| 6 | Crear bucket `landing-images` en Supabase Storage + endpoint `POST|DELETE /api/admin/content/image`. | Supabase Storage, `src/app/api/admin/content/image/` |
| 7 | Crear `LandingContent` server component: lee `site_content` (texto + image slots), fallback a `messages/en.json`. Adaptar todas las secciones para consumir desde aquí. | `LandingContent.tsx`, actualizar `page.tsx` |
| 8 | Panel admin `/[locale]/admin/content`: sección Text (lista de keys + textarea + save) + sección Images (3 cards con upload/remove/preview). | `src/app/[locale]/admin/content/page.tsx` |
| 9 | Revisión integral contra los 3 principios. Test: tabla vacía = landing funciona con defaults. | Todos los archivos del landing |

---

## 10. Métrica de validación

> **¿Un desconocido ingresó su dirección, vio un precio, y completó el booking?**

Hasta que esto no ocurra, ningún POV, ninguna opinión de diseño, y ningún cambio de paleta importa.

---

## 11. Fuentes consultadas y descartadas

### Consultadas y parcialmente incorporadas
- 6 POVs externos (D.S., M.A., Gemini, Kimi, ChatGPT, Mistral) — ver `spec-v8.4-landing-vip-analysis.md`
- `v8.3_PLAN_DE_CONSTRUCCION.md`
- `Mejoras8.3v0.2 (2).md`
- `Plan_Precios_Suciedad_V4.pdf`
- `Critica_V3_Dignidad.md`
- `dashboard-cards.md`
- Paleta actual en `src/design/tokens.ts` (verificada — sin cambios necesarios)
- Sistema de i18n existente (`messages/en.json`, `next-intl`)

### Explicitamente descartadas para este documento
- `spec-v8.4-landing-vip-analysis.md` — reemplazada por este documento
- Propuesta de 5 actos narrativos — requiere fotos que no existen
- Propuesta de paleta nueva — premature optimization sin evidencia
- Propuesta de dos caminos (A y B) — el dueño estableció un solo camino con segmentación por precio
- Cualquier recomendación de cambiar el stack (WordPress, Webflow, etc.)

---

*Documento final. Cualquier cambio futuro a este landing debe justificarse contra al menos uno de los tres principios rectores (rentabilidad, evidencia, profesionalismo) o contra evidencia de conversión medida.*
