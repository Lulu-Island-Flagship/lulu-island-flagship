/**
 * v8.3 F.9 — Onboarding Digital (Wizard de 5 Pantallas).
 *
 * Primer login en PWA → wizard secuencial que el empleado recorre antes
 * de acceder a la PWA completa. Las 5 pantallas son:
 *
 *   Pantalla 1 — Bienvenida y propósito.
 *     «Bienvenido a Lulu Island Flagship. No solo limpiamos casas:
 *     protegemos el patrimonio de familias en Richmond.»
 *
 *   Pantalla 2 — Demo interactiva de la PWA.
 *     Recorrido guiado por las secciones clave: checklist pre-jornada,
 *     SOP en campo, cierre de jornada, ganancias, perfil.
 *
 *   Pantalla 3 — Conoce a tus compañeros.
 *     Fotos y nombres de los miembros del equipo asignado. Solo muestra
 *     compañeros del mismo equipo — no expone a toda la empresa.
 *
 *   Pantalla 4 — Tu primer día.
 *     Checklist: hora de llegada, qué traer, a quién reportar, qué esperar
 *     en tu primera orden, cómo funciona el Day Rate.
 *
 *   Pantalla 5 — Canales de ayuda.
 *     Botón SOS en PWA, chat diferido con admin, teléfono de emergencia,
 *     documentos de referencia (WorkSafeBC, code of conduct).
 *
 * Este módulo contiene SOLO los datos y la lógica de progreso. El
 * componente UI (OnboardingWizard.tsx) consume estos datos para renderizar
 * cada pantalla y decidir navegación (siguiente, anterior, finalizar).
 *
 * Funciones puras: determinan el estado del wizard, validan el progreso,
 * y construyen los view-models para cada pantalla. No tocan la base de datos
 * — el caller (ruta API o server component) obtiene los datos del equipo y
 * del empleado, y los pasa aquí.
 */

// ---------------------------------------------------------------------------
// Tipos de pantalla
// ---------------------------------------------------------------------------

/** Identificador de cada pantalla del wizard. */
export type OnboardingScreenId =
  | "welcome"
  | "demo"
  | "teammates"
  | "first_day"
  | "help";

/** Orden canónico de las pantallas (índice = posición en la secuencia). */
export const ONBOARDING_SCREEN_ORDER: readonly OnboardingScreenId[] = [
  "welcome",
  "demo",
  "teammates",
  "first_day",
  "help",
] as const;

/** Total de pantallas. */
export const ONBOARDING_TOTAL_SCREENS = ONBOARDING_SCREEN_ORDER.length;

// ---------------------------------------------------------------------------
// Datos del empleado (provistos por el caller)
// ---------------------------------------------------------------------------

/** Datos del empleado nuevo necesarios para personalizar el wizard. */
export interface OnboardingEmployeeData {
  employeeId: string;
  firstName: string;
  /** Rol: cleaner, supervisor, driver. */
  role: "cleaner" | "supervisor" | "driver";
  /** Fecha de contratación (YYYY-MM-DD). */
  hireDate: string;
  /** Día y hora del primer turno (ISO). */
  firstShiftAtIso: string | null;
  /** Zona asignada (ej. "Richmond Centro"). */
  assignedZone: string;
}

/** Datos de un compañero de equipo (solo nombre, foto, rol — mínimo necesario). */
export interface TeammateInfo {
  employeeId: string;
  firstName: string;
  /** URL de la foto en Supabase Storage. */
  photoUrl: string | null;
  role: "cleaner" | "supervisor" | "driver";
  /** Antigüedad en meses. */
  tenureMonths: number;
  /** Idiomas que habla (ej. ["English", "Mandarin"]). */
  languages: string[];
}

// ---------------------------------------------------------------------------
// Tipos de cada pantalla (view-models)
// ---------------------------------------------------------------------------

/** Pantalla 1: Bienvenida. */
export interface WelcomeScreenData {
  screenId: "welcome";
  employeeFirstName: string;
  /** Título principal. */
  title: string;
  /** Mensaje de bienvenida. */
  message: string;
  /** Subtítulo con propósito. */
  purpose: string;
}

/** Pantalla 2: Demo de la PWA. */
export interface DemoScreenData {
  screenId: "demo";
  /** Pasos del recorrido guiado. */
  tourSteps: PwaTourStep[];
}

/** Un paso del recorrido guiado por la PWA. */
export interface PwaTourStep {
  /** Identificador del elemento UI a resaltar. */
  targetElementId: string;
  /** Título del tooltip. */
  title: string;
  /** Descripción del tooltip. */
  description: string;
  /** Ícono asociado (emoji). */
  icon: string;
}

/** Pantalla 3: Compañeros. */
export interface TeammatesScreenData {
  screenId: "teammates";
  /** Compañeros del mismo equipo. */
  teammates: TeammateInfo[];
  /** Nombre del equipo. */
  teamName: string;
  /** Si no hay compañeros todavía (primer empleado del equipo). */
  isFirstInTeam: boolean;
}

/** Pantalla 4: Primer día. */
export interface FirstDayScreenData {
  screenId: "first_day";
  /** Fecha del primer turno formateada. */
  firstShiftDate: string;
  /** Hora de llegada. */
  arrivalTime: string;
  /** Checklist de items para el primer día. */
  checklist: FirstDayChecklistItem[];
  /** A quién reportar (nombre del supervisor). */
  reportingTo: string | null;
  /** Cuánto se gana (Day Rate estimado). */
  estimatedDayRateCents: number;
}

/** Un item del checklist del primer día. */
export interface FirstDayChecklistItem {
  label: string;
  detail: string;
  icon: string;
}

/** Pantalla 5: Canales de ayuda. */
export interface HelpScreenData {
  screenId: "help";
  /** Canales de ayuda disponibles. */
  channels: HelpChannel[];
}

/** Un canal de ayuda. */
export interface HelpChannel {
  channelId: string;
  label: string;
  description: string;
  /** Cómo acceder (ej. "Botón SOS en PWA", "Botón rojo flotante"). */
  howToAccess: string;
  /** Tiempo de respuesta esperado. */
  responseTime: string;
  icon: string;
}

/** Unión discriminada de todas las pantallas. */
export type OnboardingScreenData =
  | WelcomeScreenData
  | DemoScreenData
  | TeammatesScreenData
  | FirstDayScreenData
  | HelpScreenData;

// ---------------------------------------------------------------------------
// Estado y progreso del wizard
// ---------------------------------------------------------------------------

/** Progreso del empleado en el wizard. */
export interface OnboardingProgress {
  employeeId: string;
  /** IDs de pantallas ya completadas. */
  completedScreens: OnboardingScreenId[];
  /** ID de la pantalla actual. */
  currentScreen: OnboardingScreenId;
  /** El wizard se completó cuando las 5 pantallas están en completedScreens. */
  completed: boolean;
  /** Fecha/hora en que se completó el wizard (ISO). */
  completedAtIso: string | null;
}

// ---------------------------------------------------------------------------
// Constantes de contenido
// ---------------------------------------------------------------------------

/** Pantalla 1: contenido estático de bienvenida. */
const WELCOME_MESSAGE = `Bienvenido a Lulu Island Flagship. No solo limpiamos casas: protegemos el patrimonio de familias en Richmond. Cada servicio que hacemos mantiene un hogar seguro, saludable y valioso.`;

const PURPOSE_MESSAGE = `Tu trabajo importa. Cada vez que un cliente ve su casa después de nuestro servicio, siente alivio, orgullo y tranquilidad. Tú haces eso posible.`;

/** Pantalla 2: pasos del tour guiado. */
const PWA_TOUR_STEPS: PwaTourStep[] = [
  {
    targetElementId: "pre-shift-checklist",
    title: "Checklist Pre-Jornada",
    description: "Antes de salir, revisa tu sueño, ánimo, clima del día y ruta. El sistema te alerta si necesitas hidratación extra o si la batería está baja.",
    icon: "✅",
  },
  {
    targetElementId: "sop-field-view",
    title: "SOP en Campo",
    description: "Instrucciones paso a paso para cada zona de la propiedad. Con alertas de seguridad química (poka-yoke: color + ícono). El sistema te protege de errores.",
    icon: "📋",
  },
  {
    targetElementId: "shift-close",
    title: "Cierre de Jornada",
    description: "Al terminar, reporta tus 3 preguntas de auto-evaluación, revisa tus ganancias del día y comparte una Nota de Cuidado para el cliente.",
    icon: "🔒",
  },
  {
    targetElementId: "earnings-dashboard",
    title: "Tus Ganancias",
    description: "Ve en tiempo real cuánto ganaste hoy, tu proyección quincenal y cuándo es tu próximo depósito. Sin ansiedad financiera.",
    icon: "💰",
  },
  {
    targetElementId: "profile-section",
    title: "Tu Perfil y Crecimiento",
    description: "Insignias, ruta de carrera, métricas personales (solo tuyas, sin comparaciones con otros). Tu progreso, a tu ritmo.",
    icon: "⭐",
  },
];

/** Pantalla 3: mensaje cuando no hay compañeros todavía. */
const _NO_TEAMMATES_MESSAGE = "Eres el primer miembro de tu equipo. Pronto se unirán más compañeros — mientras tanto, tu supervisor directo te acompañará en cada paso.";

/** Pantalla 4: checklist del primer día. */
const FIRST_DAY_CHECKLIST: FirstDayChecklistItem[] = [
  {
    label: "Uniforme",
    detail: "Recibirás tu uniforme Lulu al llegar. Vístelo con orgullo — representa confianza para el cliente.",
    icon: "👕",
  },
  {
    label: "Botella de agua",
    detail: "Trae tu propia botella. El sistema te recordará hidratarte si la jornada es pesada o hace calor.",
    icon: "💧",
  },
  {
    label: "Teléfono cargado",
    detail: "La PWA necesita batería. Carga tu teléfono al 100% antes de salir. Si baja del 30%, recibe una alerta.",
    icon: "📱",
  },
  {
    label: "Documento de identidad",
    detail: "Siempre lleva una identificación. Algunos clientes pueden pedir verificarla al llegar.",
    icon: "🪪",
  },
  {
    label: "Llegar 15 min antes",
    detail: "Tu primer día, llega 15 minutos antes para conocer a tu equipo, revisar el vehículo y el inventario.",
    icon: "⏰",
  },
];

/** Pantalla 5: canales de ayuda. */
const HELP_CHANNELS: HelpChannel[] = [
  {
    channelId: "sos_button",
    label: "Botón SOS",
    description: "Para emergencias en campo: te sientes inseguro, el cliente no está, ocurrió un accidente. Toca el botón SOS.",
    howToAccess: "Botón rojo flotante en la esquina inferior derecha de la PWA, siempre visible durante el servicio activo.",
    responseTime: "Inmediato — el admin recibe una alerta de alta prioridad.",
    icon: "🆘",
  },
  {
    channelId: "admin_chat",
    label: "Chat Diferido con Coordinación",
    description: "Para temas no urgentes: cambio de día de pago, dudas de certificación, vacaciones, problemas administrativos.",
    howToAccess: "Sección 'Mensajes' en la PWA → 'Nuevo mensaje para coordinación'.",
    responseTime: "Dentro de 24 horas hábiles.",
    icon: "💬",
  },
  {
    channelId: "emergency_phone",
    label: "Teléfono de Emergencia",
    description: "Si la PWA no funciona o la situación es crítica, llama directamente a la línea de emergencia.",
    howToAccess: "Número visible en la pantalla de bloqueo de la PWA y en tu tarjeta de empleado física.",
    responseTime: "Inmediato — alguien responde 24/7.",
    icon: "📞",
  },
  {
    channelId: "worksafe_bc",
    label: "WorkSafeBC",
    description: "Derechos laborales, seguridad ocupacional, protocolos de lesiones. Información oficial de BC.",
    howToAccess: "Enlace en la sección 'Ayuda' → 'Recursos WorkSafeBC'.",
    responseTime: "N/A — recurso informativo.",
    icon: "🛡️",
  },
  {
    channelId: "code_of_conduct",
    label: "Código de Conducta",
    description: "Nuestros valores, reglas de convivencia, política anti-discriminación y confidencialidad del cliente.",
    howToAccess: "Enlace en la sección 'Ayuda' → 'Código de Conducta'.",
    responseTime: "N/A — documento de referencia.",
    icon: "📜",
  },
];

// ---------------------------------------------------------------------------
// Construcción de datos por pantalla
// ---------------------------------------------------------------------------

/**
 * Construye los datos de la Pantalla 1 (Bienvenida).
 */
export function buildWelcomeScreen(employee: OnboardingEmployeeData): WelcomeScreenData {
  return {
    screenId: "welcome",
    employeeFirstName: employee.firstName,
    title: `¡Bienvenido, ${employee.firstName}!`,
    message: WELCOME_MESSAGE,
    purpose: PURPOSE_MESSAGE,
  };
}

/**
 * Construye los datos de la Pantalla 2 (Demo de la PWA).
 */
export function buildDemoScreen(): DemoScreenData {
  return {
    screenId: "demo",
    tourSteps: PWA_TOUR_STEPS,
  };
}

/**
 * Construye los datos de la Pantalla 3 (Compañeros).
 *
 * Solo muestra compañeros del MISMO equipo — no expone a toda la empresa.
 * El caller DEBE filtrar teammates por team_id antes de llamar esta función.
 *
 * @param teammates - Compañeros del mismo equipo (excluyendo al empleado nuevo).
 * @param teamName - Nombre del equipo.
 */
export function buildTeammatesScreen(
  teammates: TeammateInfo[],
  teamName: string
): TeammatesScreenData {
  return {
    screenId: "teammates",
    teammates,
    teamName,
    isFirstInTeam: teammates.length === 0,
  };
}

/**
 * Construye los datos de la Pantalla 4 (Primer Día).
 *
 * @param employee - Datos del empleado.
 * @param supervisorName - Nombre del supervisor directo (null si no hay).
 * @param estimatedDayRateCents - Day Rate estimado en centavos.
 */
export function buildFirstDayScreen(
  employee: OnboardingEmployeeData,
  supervisorName: string | null,
  estimatedDayRateCents: number
): FirstDayScreenData {
  const shiftDate = employee.firstShiftAtIso
    ? formatShiftDate(employee.firstShiftAtIso)
    : "Tu primer turno será asignado pronto.";

  const arrivalTime = employee.firstShiftAtIso
    ? formatArrivalTime(employee.firstShiftAtIso)
    : "Por confirmar";

  return {
    screenId: "first_day",
    firstShiftDate: shiftDate,
    arrivalTime,
    checklist: FIRST_DAY_CHECKLIST,
    reportingTo: supervisorName,
    estimatedDayRateCents,
  };
}

/**
 * Construye los datos de la Pantalla 5 (Ayuda).
 */
export function buildHelpScreen(): HelpScreenData {
  return {
    screenId: "help",
    channels: HELP_CHANNELS,
  };
}

// ---------------------------------------------------------------------------
// Progreso del wizard
// ---------------------------------------------------------------------------

/**
 * Inicializa el progreso del wizard para un empleado nuevo.
 * Comienza en la primera pantalla, sin pantallas completadas.
 */
export function initOnboardingProgress(employeeId: string): OnboardingProgress {
  return {
    employeeId,
    completedScreens: [],
    currentScreen: ONBOARDING_SCREEN_ORDER[0],
    completed: false,
    completedAtIso: null,
  };
}

/**
 * Determina la siguiente pantalla después de completar la actual.
 * Retorna null si el wizard ya terminó.
 */
export function getNextScreen(current: OnboardingScreenId): OnboardingScreenId | null {
  const idx = ONBOARDING_SCREEN_ORDER.indexOf(current);
  if (idx === -1 || idx >= ONBOARDING_SCREEN_ORDER.length - 1) return null;
  return ONBOARDING_SCREEN_ORDER[idx + 1];
}

/**
 * Determina la pantalla anterior. Retorna null si ya está en la primera.
 */
export function getPreviousScreen(current: OnboardingScreenId): OnboardingScreenId | null {
  const idx = ONBOARDING_SCREEN_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return ONBOARDING_SCREEN_ORDER[idx - 1];
}

/**
 * Marca una pantalla como completada y avanza a la siguiente.
 * Si era la última, marca el wizard como completado.
 *
 * @returns El nuevo estado de progreso.
 */
export function advanceOnboardingScreen(
  progress: OnboardingProgress,
  nowIso: string
): OnboardingProgress {
  const alreadyCompleted = progress.completedScreens.includes(progress.currentScreen);
  const updatedCompleted = alreadyCompleted
    ? progress.completedScreens
    : [...progress.completedScreens, progress.currentScreen];

  const nextScreen = getNextScreen(progress.currentScreen);

  if (nextScreen === null) {
    // Última pantalla completada
    return {
      ...progress,
      completedScreens: updatedCompleted,
      completed: true,
      completedAtIso: nowIso,
    };
  }

  return {
    ...progress,
    completedScreens: updatedCompleted,
    currentScreen: nextScreen,
    completed: false,
  };
}

/**
 * ¿Puede el empleado avanzar a la siguiente pantalla?
 * Siempre true — el wizard es lineal y no tiene validaciones de
 * completitud (el empleado puede avanzar aunque no haya "hecho" nada
 * en la pantalla actual, porque es informativo).
 */
export function canAdvance(_progress: OnboardingProgress): boolean {
  return true;
}

/**
 * ¿Puede el empleado retroceder?
 * True si no está en la primera pantalla.
 */
export function canGoBack(progress: OnboardingProgress): boolean {
  return getPreviousScreen(progress.currentScreen) !== null;
}

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

/** Formatea la fecha del primer turno: «Viernes 18 de Agosto, 2026». */
function formatShiftDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Formatea la hora de llegada: «8:45 AM (llegar 8:30 AM)». */
function formatArrivalTime(isoString: string): string {
  const date = new Date(isoString);
  const arrival = new Date(date.getTime() - 15 * 60 * 1000); // 15 min antes
  const shiftTime = date.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const arrivalTime = arrival.toLocaleTimeString("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${shiftTime} (llega ${arrivalTime})`;
}
