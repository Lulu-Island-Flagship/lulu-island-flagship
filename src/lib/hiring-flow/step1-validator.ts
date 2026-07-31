// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). No tiene integración con el resto del sistema todavía.
//
// Validación pura del Paso 1 ("Información personal") de la aplicación de
// candidatos. Regla del plan: "toda validación debe estar en un
// Step1Validator que se puede testear unitariamente sin levantar HTTP" --
// por eso este archivo no importa nada de Supabase/HTTP y no hace I/O.

export interface Step1Input {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  // ISO 'YYYY-MM-DD'.
  dateOfBirth: string;
}

export interface Step1ValidationError {
  field: string;
  message: string;
}

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;

// Regex razonable (no RFC5322 completo): local@domain con al menos un punto
// en el dominio. Suficiente para atrapar typos comunes sin rechazar
// direcciones válidas legítimas.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Teléfono canadiense: acepta con o sin prefijo país "+1"/"1", y con
// separadores comunes (espacios, guiones, paréntesis, puntos). Tras quitar
// todo lo que no sea dígito y un eventual "1" inicial de país, deben quedar
// exactamente 10 dígitos (NPA-NXX-XXXX norteamericano).
// Ejemplos válidos: "604-555-0123", "+1 604 555 0123", "(604) 555-0123",
// "16045550123".
const PHONE_DIGITS_PATTERN = /^\d{10}$/;

function cleanPhoneDigits(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, "");
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return digitsOnly.slice(1);
  }
  return digitsOnly;
}

// [ASSUMPTION — verificar edad mínima exacta aplicable a este
// empleador/industria contra Employment Standards Act de BC antes de
// producción]. BC permite trabajar desde los 16 años en la mayoría de
// industrias como edad mínima general, pero hay excepciones sectoriales
// (ej. ciertos trabajos peligrosos exigen 18+, y menores de 16 pueden
// trabajar en algunos roles ligeros con permiso de un padre/tutor). Este
// valor se deja como constante exportada (no como número mágico embebido
// en la función) para que sea fácil de corregir/parametrizar más adelante.
// TODO: mover MIN_AGE_YEARS a settings-service (system_settings) cuando
// exista una key dedicada, en vez de una constante hardcodeada aquí.
export const MIN_AGE_YEARS = 16;

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  // Rechaza fechas "desbordadas" que Date normaliza silenciosamente, ej.
  // "2023-02-30" -> 2023-03-02.
  const [year, month, day] = value.split("-").map(Number);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

// Edad en años completos a `referenceDate`, calculada por cumpleaños (no
// por división de días), para que el boundary del día exacto del
// cumpleaños sea correcto.
function calculateAge(dateOfBirth: string, referenceDate: Date): number {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split("-").map(Number);
  let age = referenceDate.getUTCFullYear() - birthYear;
  const refMonth = referenceDate.getUTCMonth() + 1;
  const refDay = referenceDate.getUTCDate();
  const hasHadBirthdayThisYear =
    refMonth > birthMonth || (refMonth === birthMonth && refDay >= birthDay);
  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }
  return age;
}

function validateName(value: string, field: string): Step1ValidationError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { field, message: `${field} is required` };
  }
  if (trimmed.length < NAME_MIN_LENGTH) {
    return {
      field,
      message: `${field} must be at least ${NAME_MIN_LENGTH} characters`,
    };
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    return {
      field,
      message: `${field} must be at most ${NAME_MAX_LENGTH} characters`,
    };
  }
  return null;
}

export function validateStep1(
  input: Step1Input,
  referenceDate: Date = new Date()
): Step1ValidationError[] {
  // Acumula TODOS los errores en vez de retornar en el primero (regla del
  // manifiesto del proyecto para validaciones de objetos compuestos).
  const errors: Step1ValidationError[] = [];

  const firstNameError = validateName(input.firstName ?? "", "firstName");
  if (firstNameError) errors.push(firstNameError);

  const lastNameError = validateName(input.lastName ?? "", "lastName");
  if (lastNameError) errors.push(lastNameError);

  const email = (input.email ?? "").trim();
  if (email.length === 0) {
    errors.push({ field: "email", message: "email is required" });
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ field: "email", message: "email is not a valid email address" });
  }

  const phone = input.phone ?? "";
  if (phone.trim().length === 0) {
    errors.push({ field: "phone", message: "phone is required" });
  } else if (!PHONE_DIGITS_PATTERN.test(cleanPhoneDigits(phone))) {
    errors.push({
      field: "phone",
      message:
        "phone must be a valid Canadian phone number (10 digits, optionally prefixed with +1 or 1)",
    });
  }

  const dateOfBirth = input.dateOfBirth ?? "";
  if (dateOfBirth.trim().length === 0) {
    errors.push({ field: "dateOfBirth", message: "dateOfBirth is required" });
  } else if (!isValidIsoDate(dateOfBirth)) {
    errors.push({
      field: "dateOfBirth",
      message: "dateOfBirth must be a valid date in YYYY-MM-DD format",
    });
  } else {
    // Decisión de boundary: cumplir MIN_AGE_YEARS exactamente el día de
    // referenceDate SÍ es válido (edad calculada por cumpleaños; el
    // candidato que hoy cumple 16 ya tiene 16 años cumplidos, no 15).
    // Se testea explícitamente este boundary en step1-validator.test.ts.
    const age = calculateAge(dateOfBirth, referenceDate);
    if (age < MIN_AGE_YEARS) {
      errors.push({
        field: "dateOfBirth",
        message: `Candidate must be at least ${MIN_AGE_YEARS} years old`,
      });
    }
  }

  return errors;
}

export function isStep1Valid(input: Step1Input, referenceDate: Date = new Date()): boolean {
  return validateStep1(input, referenceDate).length === 0;
}
