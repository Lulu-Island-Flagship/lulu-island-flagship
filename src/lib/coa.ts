/**
 * Capa 1 — Financial Core: Chart of Accounts (COA) canadiense GAAP (ASPE).
 *
 * Estructura de codificación:
 *  1000–1999  Activos (Assets)
 *  2000–2999  Pasivos (Liabilities)
 *  3000–3999  Patrimonio (Equity)
 *  4000–4999  Ingresos (Revenue)
 *  5000–5999  Costos Directos (Direct Costs / COGS)
 *  6000–6999  Gastos Operativos (Operating Expenses)
 *  7000–7999  Otros Ingresos y Gastos (Other Income & Expenses)
 *
 * Toda cuenta declarada aquí es fuente de verdad para asientos contables.
 * Los montos se representan en centavos (CAD) — consistente con el resto
 * del sistema (payroll.ts, shadow-ledger.ts, operational-accounting.ts).
 *
 * ASPE Sección 1000–1800: marco contable para empresas privadas canadienses.
 */

/** Tipo contable principal según GAAP canadiense (ASPE). */
export type AccountType =
  | "ACTIVO"
  | "PASIVO"
  | "PATRIMONIO"
  | "INGRESO"
  | "GASTO";

/** Subtipo contable para clasificación más fina dentro de cada tipo. */
export type AccountSubtype =
  | "ACTIVO_CORRIENTE"
  | "ACTIVO_FIJO"
  | "DEPRECIACION_ACUMULADA"
  | "PASIVO_CORRIENTE"
  | "PASIVO_ACUMULADO"
  | "PASIVO_PROVISION"
  | "PATRIMONIO_NETO"
  | "INGRESO_OPERATIVO"
  | "CONTRA_INGRESO"
  | "COSTO_DIRECTO"
  | "GASTO_OPERATIVO"
  | "OTRO_INGRESO"
  | "OTRO_GASTO"
  | "IMPUESTO_RENTA";

/**
 * Cuenta individual del Chart of Accounts.
 *
 * @property cuenta_id — identificador único de la cuenta en el sistema.
 * @property codigo — código numérico de 4 dígitos (ej. 1010, 2020).
 * @property nombre — nombre descriptivo de la cuenta en español.
 * @property tipo — clasificación GAAP principal (ACTIVO, PASIVO, etc.).
 * @property subtipo — clasificación más granular.
 * @property descripcion — nota de uso para los contadores / sistema de imputación automática.
 * @property esContraCuenta — indica si la cuenta es de naturaleza contraria a su tipo (ej. depreciación acumulada, descuentos).
 */
export interface CuentaCOA {
  readonly cuenta_id: string;
  readonly codigo: string;
  readonly nombre: string;
  readonly tipo: AccountType;
  readonly subtipo: AccountSubtype;
  readonly descripcion: string;
  readonly esContraCuenta: boolean;
}

// ---------------------------------------------------------------------------
// 1000 — Activos (Assets)
// ---------------------------------------------------------------------------

const ACTIVOS: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_1010",
    codigo: "1010",
    nombre: "Cash",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion: "Efectivo en cuentas bancarias operativas y caja chica consolidada.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1015",
    codigo: "1015",
    nombre: "Petty Cash",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion: "Efectivo físico para gastos menores de operación diaria.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1020",
    codigo: "1020",
    nombre: "Accounts Receivable",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion: "Cuentas por cobrar a clientes por servicios prestados, neto de estimaciones.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1025",
    codigo: "1025",
    nombre: "Allowance for Doubtful Accounts",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion:
      "Estimación de incobrables (contra-cuenta de 1020). ASPE 3856: instrumentos financieros — deterioro.",
    esContraCuenta: true,
  },
  {
    cuenta_id: "coa_1030",
    codigo: "1030",
    nombre: "Inventory",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion:
      "Inventario de suministros, químicos, uniformes y productos para reventa. Valuado al menor de costo o valor neto realizable (ASPE 3031).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1035",
    codigo: "1035",
    nombre: "Work-in-Progress",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion:
      "Servicios en curso no facturados al cierre del período (mano de obra + materiales asignados).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1040",
    codigo: "1040",
    nombre: "Prepaid Expenses",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion:
      "Gastos pagados por anticipado: seguros, renta, software, licencias. Se devengan al período que corresponde.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1045",
    codigo: "1045",
    nombre: "Prepaid Insurance",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion:
      "Primas de seguro pagadas por adelantado (responsabilidad civil, vehículos, propiedad).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1100",
    codigo: "1100",
    nombre: "Fixed Assets",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_FIJO",
    descripcion:
      "Activos fijos tangibles al costo histórico. ASPE 3061: propiedad, planta y equipo.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1105",
    codigo: "1105",
    nombre: "Vehicles",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_FIJO",
    descripcion:
      "Vehículos de flota para operaciones de servicio en sitio. Incluye costo de adquisición y mejoras capitalizables.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1106",
    codigo: "1106",
    nombre: "Accumulated Depreciation — Vehicles",
    tipo: "ACTIVO",
    subtipo: "DEPRECIACION_ACUMULADA",
    descripcion:
      "Depreciación acumulada de vehículos de flota. Contra-cuenta de 1105.",
    esContraCuenta: true,
  },
  {
    cuenta_id: "coa_1110",
    codigo: "1110",
    nombre: "Accumulated Depreciation",
    tipo: "ACTIVO",
    subtipo: "DEPRECIACION_ACUMULADA",
    descripcion:
      "Depreciación acumulada genérica de activos fijos. Contra-cuenta de 1100.",
    esContraCuenta: true,
  },
  {
    cuenta_id: "coa_1115",
    codigo: "1115",
    nombre: "Equipment",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_FIJO",
    descripcion:
      "Equipo operativo: aspiradoras, hidrolavadoras, pulidoras, escaleras, herramientas especializadas.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1116",
    codigo: "1116",
    nombre: "Accumulated Depreciation — Equipment",
    tipo: "ACTIVO",
    subtipo: "DEPRECIACION_ACUMULADA",
    descripcion:
      "Depreciación acumulada de equipo operativo. Contra-cuenta de 1115.",
    esContraCuenta: true,
  },
  {
    cuenta_id: "coa_1120",
    codigo: "1120",
    nombre: "Computer Equipment",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_FIJO",
    descripcion:
      "Hardware de cómputo: laptops, tablets de campo, servidores, impresoras. CCA Clase 50 (55% declining balance).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1121",
    codigo: "1121",
    nombre: "Accumulated Depreciation — Computer Equipment",
    tipo: "ACTIVO",
    subtipo: "DEPRECIACION_ACUMULADA",
    descripcion:
      "Depreciación acumulada de equipo de cómputo. Contra-cuenta de 1120.",
    esContraCuenta: true,
  },
  {
    cuenta_id: "coa_1130",
    codigo: "1130",
    nombre: "Leasehold Improvements",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_FIJO",
    descripcion:
      "Mejoras a propiedades arrendadas (oficina, bodega). Amortizadas en el menor de vida útil o plazo del arrendamiento.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_1131",
    codigo: "1131",
    nombre: "Accumulated Amortization — Leasehold Improvements",
    tipo: "ACTIVO",
    subtipo: "DEPRECIACION_ACUMULADA",
    descripcion:
      "Amortización acumulada de mejoras a propiedades arrendadas. Contra-cuenta de 1130.",
    esContraCuenta: true,
  },
];

// ---------------------------------------------------------------------------
// 2000 — Pasivos (Liabilities)
// ---------------------------------------------------------------------------

const PASIVOS: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_2010",
    codigo: "2010",
    nombre: "Accounts Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "Cuentas por pagar a proveedores por bienes y servicios recibidos, no pagados al cierre.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2020",
    codigo: "2020",
    nombre: "GST Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "GST/HST cobrado a clientes (5% federal) pendiente de remitir a la CRA. Aplica para ingresos superiores a $30,000 (small supplier threshold).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2025",
    codigo: "2025",
    nombre: "GST Input Tax Credits Receivable",
    tipo: "ACTIVO",
    subtipo: "ACTIVO_CORRIENTE",
    descripcion:
      "ITCs de GST/HST pagado en compras, compensable contra GST Payable en la declaración.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2030",
    codigo: "2030",
    nombre: "PST Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "PST provincial (BC 7%) cobrado a clientes, pendiente de remitir al Ministry of Finance de BC.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2040",
    codigo: "2040",
    nombre: "CPP Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "Canada Pension Plan — aportes del empleado retenidos + aporte patronal, pendientes de remitir a la CRA.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2050",
    codigo: "2050",
    nombre: "EI Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "Employment Insurance — primas del empleado retenidas + aporte patronal (1.4x), pendientes de remitir a la CRA.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2060",
    codigo: "2060",
    nombre: "Income Tax Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "Retenciones de income tax federal/provincial de nómina, pendientes de remitir a la CRA.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2070",
    codigo: "2070",
    nombre: "Vacation Accrual",
    tipo: "PASIVO",
    subtipo: "PASIVO_ACUMULADO",
    descripcion:
      "Vacaciones devengadas no tomadas. BC ESA: mínimo 4% del gross wages (2 semanas/año) o 6% tras 5 años (3 semanas/año).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2080",
    codigo: "2080",
    nombre: "Wages Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "Salarios devengados no pagados al cierre del período de nómina.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2085",
    codigo: "2085",
    nombre: "WorkSafeBC Payable",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "Primas de WorkSafeBC (workers' compensation) devengadas y pendientes de pago. Calculadas sobre nómina bruta según classification unit.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2090",
    codigo: "2090",
    nombre: "Accrued Liabilities",
    tipo: "PASIVO",
    subtipo: "PASIVO_ACUMULADO",
    descripcion:
      "Pasivos devengados varios: facturas de proveedores no recibidas, servicios consumidos no facturados al cierre.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2095",
    codigo: "2095",
    nombre: "Warranty Provision",
    tipo: "PASIVO",
    subtipo: "PASIVO_PROVISION",
    descripcion:
      "Provisión por garantía de servicio (rework gratuito dentro del período de garantía). ASPE 3290: contingencias.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_2100",
    codigo: "2100",
    nombre: "Gift Card Liability",
    tipo: "PASIVO",
    subtipo: "PASIVO_CORRIENTE",
    descripcion:
      "Obligación por gift cards vendidas no redimidas. Se reconoce ingreso al redimir o por breakage (ASPE 3400).",
    esContraCuenta: false,
  },
];

// ---------------------------------------------------------------------------
// 3000 — Patrimonio (Equity)
// ---------------------------------------------------------------------------

const PATRIMONIO: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_3010",
    codigo: "3010",
    nombre: "Owner's Equity",
    tipo: "PATRIMONIO",
    subtipo: "PATRIMONIO_NETO",
    descripcion:
      "Capital aportado por el propietario. En empresa unipersonal, representa la inversión neta del dueño.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_3020",
    codigo: "3020",
    nombre: "Retained Earnings",
    tipo: "PATRIMONIO",
    subtipo: "PATRIMONIO_NETO",
    descripcion:
      "Utilidades retenidas acumuladas de ejercicios anteriores. El net income del período se cierra contra esta cuenta al final del año fiscal.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_3030",
    codigo: "3030",
    nombre: "Owner's Draws",
    tipo: "PATRIMONIO",
    subtipo: "PATRIMONIO_NETO",
    descripcion:
      "Retiros del propietario durante el ejercicio. Contra-cuenta que reduce el patrimonio neto. Se cierra contra Owner's Equity al final del período.",
    esContraCuenta: true,
  },
];

// ---------------------------------------------------------------------------
// 4000 — Ingresos (Revenue)
// ---------------------------------------------------------------------------

const INGRESOS: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_4010",
    codigo: "4010",
    nombre: "Service Revenue",
    tipo: "INGRESO",
    subtipo: "INGRESO_OPERATIVO",
    descripcion:
      "Ingresos por servicios principales de limpieza/mantenimiento/en sitio. Base de facturación estándar.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_4020",
    codigo: "4020",
    nombre: "Upsell Revenue",
    tipo: "INGRESO",
    subtipo: "INGRESO_OPERATIVO",
    descripcion:
      "Ingresos por servicios adicionales vendidos durante la visita (add-ons, upgrades en sitio).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_4030",
    codigo: "4030",
    nombre: "Gift Card Revenue",
    tipo: "INGRESO",
    subtipo: "INGRESO_OPERATIVO",
    descripcion:
      "Ingresos reconocidos al redimir gift cards contra servicios prestados.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_4035",
    codigo: "4035",
    nombre: "Gift Card Breakage Revenue",
    tipo: "INGRESO",
    subtipo: "INGRESO_OPERATIVO",
    descripcion:
      "Ingreso por gift cards no redimidas cuya probabilidad de redención es remota (breakage, ASPE 3400). Se reconoce proporcionalmente al patrón de redención.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_4040",
    codigo: "4040",
    nombre: "Referral Revenue",
    tipo: "INGRESO",
    subtipo: "INGRESO_OPERATIVO",
    descripcion:
      "Ingresos por comisiones o bonos de programas de referidos de clientes.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_4050",
    codigo: "4050",
    nombre: "Cancellation Fee Revenue",
    tipo: "INGRESO",
    subtipo: "INGRESO_OPERATIVO",
    descripcion:
      "Ingresos por penalidades de cancelación tardía o no-show del cliente.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_4060",
    codigo: "4060",
    nombre: "Rush Service Fee Revenue",
    tipo: "INGRESO",
    subtipo: "INGRESO_OPERATIVO",
    descripcion:
      "Recargos por servicio urgente o fuera de horario regular (same-day, after-hours, weekend premium).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_4100",
    codigo: "4100",
    nombre: "Discounts",
    tipo: "INGRESO",
    subtipo: "CONTRA_INGRESO",
    descripcion:
      "Descuentos comerciales otorgados sobre el precio de lista. Contra-cuenta de ingresos — reduce el revenue bruto para llegar al neto.",
    esContraCuenta: true,
  },
  {
    cuenta_id: "coa_4105",
    codigo: "4105",
    nombre: "Sales Returns and Allowances",
    tipo: "INGRESO",
    subtipo: "CONTRA_INGRESO",
    descripcion:
      "Devoluciones, reembolsos parciales y ajustes de facturación. Contra-cuenta de ingresos. ASPE 3400: revenue recognition.",
    esContraCuenta: true,
  },
];

// ---------------------------------------------------------------------------
// 5000 — Costos Directos (Direct Costs / COGS)
// ---------------------------------------------------------------------------

const COSTOS_DIRECTOS: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_5010",
    codigo: "5010",
    nombre: "Labor — Day Rate",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Costo de mano de obra directa pagada por día de servicio (day rate). Incluye base + QC bonus + rework pagado + ajuste de salario mínimo BC.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5020",
    codigo: "5020",
    nombre: "Payroll Taxes — Employer",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Carga patronal sobre mano de obra directa: CPP employer contribution, EI employer premium (1.4x empleado), WorkSafeBC premiums.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5030",
    codigo: "5030",
    nombre: "Supplies",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Materiales y suministros consumidos en la prestación del servicio: bolsas, trapos, esponjas, filtros, consumibles genéricos.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5040",
    codigo: "5040",
    nombre: "Equipment",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Equipo de consumo directo no capitalizable: extensiones, mangueras, boquillas, herramientas menores de reposición frecuente.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5050",
    codigo: "5050",
    nombre: "Fuel",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Combustible para vehículos de flota utilizados en desplazamiento a sitios del cliente. Incluye gasolina, diésel, carga de vehículos eléctricos.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5060",
    codigo: "5060",
    nombre: "Uniforms",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Uniformes del personal de campo: camisas, pantalones, chaquetas, calzado de seguridad con logo corporativo.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5070",
    codigo: "5070",
    nombre: "Chemical Supplies",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Productos químicos de limpieza: detergentes, desinfectantes, selladores, ceras, removedores, soluciones especializadas.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5080",
    codigo: "5080",
    nombre: "PPE & Safety Supplies",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Equipo de protección personal: guantes, mascarillas, gafas, chalecos reflectantes, rodilleras, protección auditiva.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5090",
    codigo: "5090",
    nombre: "Vehicle Maintenance",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Mantenimiento y reparación de vehículos de flota: cambios de aceite, llantas, frenos, reparaciones mecánicas no capitalizables.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_5100",
    codigo: "5100",
    nombre: "Equipment Maintenance & Repairs",
    tipo: "GASTO",
    subtipo: "COSTO_DIRECTO",
    descripcion:
      "Mantenimiento y reparación de equipo operativo no capitalizable: servicio de aspiradoras, reemplazo de piezas, calibración.",
    esContraCuenta: false,
  },
];

// ---------------------------------------------------------------------------
// 6000 — Gastos Operativos (Operating Expenses)
// ---------------------------------------------------------------------------

const GASTOS_OPERATIVOS: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_6010",
    codigo: "6010",
    nombre: "Rent",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Renta de oficina, bodega y espacios operativos. ASPE 3065: arrendamientos operativos — gasto reconocido en línea recta.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6020",
    codigo: "6020",
    nombre: "Insurance",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Primas de seguros: responsabilidad civil general, propiedad, vehículos comerciales, umbrella policy.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6030",
    codigo: "6030",
    nombre: "Marketing",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Publicidad y promoción: Google Ads, SEO, redes sociales, flyers, branding, sitio web, fotografía.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6040",
    codigo: "6040",
    nombre: "Software",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Suscripciones SaaS operativas: CRM, dispatch, contabilidad, email, almacenamiento, hosting, dominios.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6050",
    codigo: "6050",
    nombre: "Professional Fees",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Honorarios profesionales: contador público, abogado, consultor de negocio, auditor externo.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6060",
    codigo: "6060",
    nombre: "Bank Fees",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Comisiones bancarias: cargo mensual de cuenta, transferencias, NSF, chargebacks de tarjeta de crédito.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6070",
    codigo: "6070",
    nombre: "Office Supplies",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Suministros de oficina: papel, tinta, folders, bolígrafos, material administrativo genérico.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6080",
    codigo: "6080",
    nombre: "Telephone & Internet",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Servicios de telecomunicaciones: líneas móviles del equipo, internet de oficina, plan de datos para tablets de campo.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6090",
    codigo: "6090",
    nombre: "Travel & Meals",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Viajes de negocio y comidas. Atención: solo el 50% de meals & entertainment es deducible para income tax (ITA s. 67.1).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6100",
    codigo: "6100",
    nombre: "Training & Development",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Capacitación del personal: cursos, certificaciones, talleres, WHMIS, primeros auxilios, onboarding.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6110",
    codigo: "6110",
    nombre: "Licenses & Permits",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Licencias municipales, permisos de operación, registros comerciales, renovaciones anuales obligatorias.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6120",
    codigo: "6120",
    nombre: "Bad Debt Expense",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Castigo de cuentas incobrables y ajuste a la estimación de Allowance for Doubtful Accounts (1025).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6130",
    codigo: "6130",
    nombre: "Utilities",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Servicios públicos: electricidad, agua, calefacción, recolección de basura de oficina/bodega.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6140",
    codigo: "6140",
    nombre: "Repairs & Maintenance",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Mantenimiento y reparaciones de instalaciones: oficina, bodega. No incluye vehículos (5090) ni equipo operativo (5100).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_6150",
    codigo: "6150",
    nombre: "Postage & Delivery",
    tipo: "GASTO",
    subtipo: "GASTO_OPERATIVO",
    descripcion:
      "Envíos postales, courier, mensajería y flete de suministros entre locaciones.",
    esContraCuenta: false,
  },
];

// ---------------------------------------------------------------------------
// 7000 — Otros Ingresos y Gastos (Other Income & Expenses)
// ---------------------------------------------------------------------------

const OTROS_INGRESOS_GASTOS: readonly CuentaCOA[] = [
  {
    cuenta_id: "coa_7010",
    codigo: "7010",
    nombre: "Interest Income",
    tipo: "INGRESO",
    subtipo: "OTRO_INGRESO",
    descripcion:
      "Intereses ganados sobre saldos bancarios, inversiones a corto plazo y cuentas de ahorro operativas.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_7020",
    codigo: "7020",
    nombre: "Interest Expense",
    tipo: "GASTO",
    subtipo: "OTRO_GASTO",
    descripcion:
      "Intereses pagados sobre financiamiento: línea de crédito, préstamos bancarios, arrendamientos financieros, tarjetas de crédito corporativas.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_7030",
    codigo: "7030",
    nombre: "Depreciation Expense",
    tipo: "GASTO",
    subtipo: "OTRO_GASTO",
    descripcion:
      "Gasto por depreciación y amortización de activos fijos del período. Débito contra cuentas de depreciación acumulada (1106, 1116, 1121, 1131).",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_7040",
    codigo: "7040",
    nombre: "Gain / Loss on Disposal of Assets",
    tipo: "GASTO",
    subtipo: "OTRO_GASTO",
    descripcion:
      "Ganancia o pérdida por venta, retiro o disposición de activos fijos. Diferencia entre proceeds y net book value.",
    esContraCuenta: false,
  },
  {
    cuenta_id: "coa_7050",
    codigo: "7050",
    nombre: "Foreign Exchange Gain / Loss",
    tipo: "GASTO",
    subtipo: "OTRO_GASTO",
    descripcion:
      "Diferencia cambiaria por transacciones en moneda extranjera (USD principalmente). ASPE 1651: traducción de moneda extranjera.",
    esContraCuenta: false,
  },
];

// ---------------------------------------------------------------------------
// Plan de cuentas completo
// ---------------------------------------------------------------------------

/**
 * Chart of Accounts completo — fuente canónica de todas las cuentas contables
 * del sistema. 56 cuentas siguiendo el estándar canadiense GAAP (ASPE) para
 * una pequeña/mediana empresa de servicios en sitio.
 *
 * Orden de presentación: Activos → Pasivos → Patrimonio → Ingresos → Gastos
 * (orden tradicional de balance general + estado de resultados).
 */
export const CHART_OF_ACCOUNTS: readonly CuentaCOA[] = [
  ...ACTIVOS,
  ...PASIVOS,
  ...PATRIMONIO,
  ...INGRESOS,
  ...COSTOS_DIRECTOS,
  ...GASTOS_OPERATIVOS,
  ...OTROS_INGRESOS_GASTOS,
];

// ---------------------------------------------------------------------------
// Utilidades de búsqueda
// ---------------------------------------------------------------------------

/** Mapa inmutable codigo → CuentaCOA para lookup O(1). */
const COA_BY_CODE: ReadonlyMap<string, CuentaCOA> = new Map(
  CHART_OF_ACCOUNTS.map((c) => [c.codigo, c])
);

/** Mapa inmutable cuenta_id → CuentaCOA para lookup O(1). */
const COA_BY_ID: ReadonlyMap<string, CuentaCOA> = new Map(
  CHART_OF_ACCOUNTS.map((c) => [c.cuenta_id, c])
);

/**
 * Busca una cuenta por su código numérico (ej. "1010").
 *
 * @returns La cuenta o `undefined` si el código no existe en el COA.
 */
export function getCuentaByCodigo(codigo: string): CuentaCOA | undefined {
  return COA_BY_CODE.get(codigo);
}

/**
 * Busca una cuenta por su identificador único (ej. "coa_1010").
 *
 * @returns La cuenta o `undefined` si el ID no existe en el COA.
 */
export function getCuentaById(cuentaId: string): CuentaCOA | undefined {
  return COA_BY_ID.get(cuentaId);
}

/**
 * Devuelve todas las cuentas de un tipo contable específico.
 *
 * @param tipo — ACTIVO, PASIVO, PATRIMONIO, INGRESO, o GASTO.
 */
export function getCuentasByTipo(tipo: AccountType): readonly CuentaCOA[] {
  return CHART_OF_ACCOUNTS.filter((c) => c.tipo === tipo);
}

/**
 * Devuelve todas las cuentas de un subtipo específico.
 *
 * @param subtipo — clasificación granular dentro de cada tipo.
 */
export function getCuentasBySubtipo(subtipo: AccountSubtype): readonly CuentaCOA[] {
  return CHART_OF_ACCOUNTS.filter((c) => c.subtipo === subtipo);
}

/**
 * Verifica que un código de cuenta existe en el COA.
 * Útil para validación de asientos contables antes de insertar en ledger.
 */
export function isValidCuentaCodigo(codigo: string): boolean {
  return COA_BY_CODE.has(codigo);
}

/**
 * Total de cuentas en el Chart of Accounts.
 * Útil para asserts en tests de migración: el COA no debe perder cuentas accidentalmente.
 */
export const COA_TOTAL_CUENTAS: number = CHART_OF_ACCOUNTS.length;
