# NETFILE Integration — GST/HST Electronic Filing (CRA)

Documentación de integración con Canada Revenue Agency (CRA) para la
presentación electrónica de GST/HST returns vía NETFILE (T619).

## Índice

1. [Arquitectura del sistema](#arquitectura-del-sistema)
2. [Formato XML (T619 Specification)](#formato-xml-t619-specification)
3. [Pasos para certificación CRA](#pasos-para-certificación-cra)
4. [Endpoints de prueba CRA (Sandbox)](#endpoints-de-prueba-cra-sandbox)
5. [Flujo NETFILE end-to-end](#flujo-netfile-end-to-end)
6. [Manejo de errores y rechazos](#manejo-de-errores-y-rechazos)
7. [Referencias oficiales](#referencias-oficiales)

## Arquitectura del sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    Lulu Island Flagship                      │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐   │
│  │ tax-engine.ts │──▶│ tax-filing.ts│──▶│ tax-netfile.ts│   │
│  │  (cálculos)   │   │  (deadlines) │   │  (XML gen)    │   │
│  └──────────────┘   └──────────────┘   └───────┬───────┘   │
│                                                  │           │
│                          ┌───────────────────────┘           │
│                          ▼                                    │
│               ┌─────────────────────┐                        │
│               │ POST /api/admin/tax │                        │
│               │      /netfile       │                        │
│               └─────────┬───────────┘                        │
│                         │                                     │
└─────────────────────────┼─────────────────────────────────────┘
                          │ XML T619
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              CRA NETFILE / My Business Account               │
│                                                              │
│  1. Admin descarga XML desde el panel                        │
│  2. Admin sube XML al portal NETFILE de CRA                  │
│  3. CRA valida y confirma recepción                          │
│  4. Admin registra confirmación en el sistema                │
│                                                              │
│  (Futuro: integración directa vía API CRA para envío         │
│   automatizado sin intervención manual del admin)            │
└─────────────────────────────────────────────────────────────┘
```

### Capas involucradas

| Capa | Archivo | Responsabilidad |
|------|---------|-----------------|
| Capa 5a | `tax-engine.ts` | Cálculo de GST/PST desde el Financial Ledger |
| Capa 5b | `tax-filing.ts` | Fechas límite, alertas, estado de filing (PENDIENTE→RECIBIDO_CRA) |
| Capa 5c | `tax-netfile.ts` | Generación XML T619, validación, PDF de revisión, penalidades |

## Formato XML (T619 Specification)

### Namespace y estructura

El XML generado sigue la especificación T619 de CRA para GST/HST NETFILE:

- **Namespace:** `http://www.cra-arc.gc.ca/gncy/bn`
- **Root element:** `<GSTHSTReturn>`
- **Schema location:** `GST-HST-Return-Schema.xsd`

### Estructura del XML generado

```xml
<?xml version="1.0" encoding="UTF-8"?>
<GSTHSTReturn
  xmlns="http://www.cra-arc.gc.ca/gncy/bn"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.cra-arc.gc.ca/gncy/bn GST-HST-Return-Schema.xsd"
  returnType="Original"
  referencePeriod="2026-Q2"
  generatedDate="2026-08-05">

  <!-- Transmission Header — T619 Electronic Filing -->
  <TransmissionHeader>
    <TransmissionID>TX-2026Q2-{timestamp}</TransmissionID>
    <TransmissionDate>2026-08-05</TransmissionDate>
    <TransmitterSoftwareCode>LULUISLAND-FLAGSHIP-V1</TransmitterSoftwareCode>
    <TransmitterSoftwareVersion>1.0.0</TransmitterSoftwareVersion>
  </TransmissionHeader>

  <!-- GST/HST Registrant Information -->
  <RegistrantInformation>
    <BusinessNumber>123456789RT0001</BusinessNumber>
    <FiscalPeriodStart>2026-04-01</FiscalPeriodStart>
    <FiscalPeriodEnd>2026-06-30</FiscalPeriodEnd>
    <FilingFrequency>trimestral</FilingFrequency>
  </RegistrantInformation>

  <!-- GST/HST Return — Line Items (GST34) -->
  <ReturnLines>
    <Line101>25000.00</Line101>  <!-- Total sales and other revenue -->
    <Line103>1250.00</Line103>   <!-- GST/HST collected or collectible -->
    <Line104>0.00</Line104>      <!-- Adjustments (+/-) -->
    <Line105>1250.00</Line105>   <!-- Total GST/HST (103 + 104) -->
    <Line106>350.00</Line106>    <!-- Input Tax Credits -->
    <Line107>0.00</Line107>      <!-- Adjustments (+/-) -->
    <Line108>350.00</Line108>    <!-- Total ITCs (106 + 107) -->
    <Line109>900.00</Line109>    <!-- Net tax (105 − 108) -->
    <Line110>0.00</Line110>      <!-- Instalment payments -->
    <Line111>0.00</Line111>      <!-- Rebates -->
    <Line112>900.00</Line112>    <!-- Total (109 + 110 + 111) -->
    <Line113A>0.00</Line113A>    <!-- Refund claimed (if Line112 < 0) -->
    <Line115>900.00</Line115>    <!-- Payment due (if Line112 > 0) -->
  </ReturnLines>

  <!-- Supplementary Information — BC PST -->
  <SupplementaryInformation>
    <Province>BC</Province>
    <PSTCollected>1750.00</PSTCollected>
    <PSTRateApplied>7%</PSTRateApplied>
  </SupplementaryInformation>

  <!-- Declaration -->
  <Declaration>
    <CertificationStatement>
      I certify that the information given in this return is correct and complete...
    </CertificationStatement>
    <GeneratedBySystem>LULUISLAND-FLAGSHIP-V1</GeneratedBySystem>
    <GeneratedDate>2026-08-05</GeneratedDate>
  </Declaration>
</GSTHSTReturn>
```

### Líneas del GST34 en detalle

| Línea | Nombre CRA | Cálculo | Notas |
|-------|-----------|---------|-------|
| 101 | Total sales and other revenue | Suma de ventas del período | Base imponible, sin GST |
| 103 | GST/HST collected or collectible | SUM GST en ventas | 5% en BC |
| 104 | Adjustments (+/−) | Ajustes manuales | Normalmente 0 |
| 105 | Total GST/HST | 103 + 104 | |
| 106 | Input Tax Credits | SUM GST pagado en compras/gastos | ITCs recuperables |
| 107 | Adjustments (+/−) | Ajustes manuales | Normalmente 0 |
| 108 | Total ITCs | 106 + 107 | |
| 109 | Net tax | 105 − 108 | Positivo = a pagar, negativo = reembolso |
| 110 | Instalment payments | Pagos a cuenta | Normalmente 0 para small business |
| 111 | Rebates | Reembolsos | Normalmente 0 |
| 112 | Total | 109 + 110 + 111 | |
| 113A | Refund claimed | abs(112) si 112 < 0 | Solo si hay reembolso |
| 115 | Payment due | 112 si 112 > 0 | Monto a remitir a CRA |

### Business Number (BN)

```
Formato: NNNNNNNNNRT0001
         └─9 dígitos─┘└─RT─┘└0001┘
                       Program  Account
                       ID       number
```

- **9 dígitos:** Número de negocio raíz asignado por CRA al registrarse
- **RT:** Program identifier para GST/HST
- **0001:** Número de cuenta (primera cuenta GST/HST del negocio)

⚠️ El BN `123456789RT0001` es un placeholder. Reemplazar con el BN real
antes de cualquier presentación ante CRA.

## Pasos para certificación CRA

La certificación de software ante CRA es necesaria para poder transmitir
returns electrónicamente vía NETFILE. El proceso es:

### 1. Registro como Transmitter

1. Obtener un **Business Number (BN)** para Lulu Island Flagship
2. Registrar una **GST/HST program account (RT)**
3. Solicitar acceso a **NETFILE for GST/HST** vía CRA My Business Account
4. Obtener un **Web Access Code (WAC)** — código de 4 dígitos para autenticación

### 2. Certificación del software (GST/HST NETFILE Certification)

1. Solicitar el **GST/HST NETFILE Software Certification Package** a CRA:
   - Email: `GST-HST-NETFILE-Software-Certification@cra-arc.gc.ca`
   - Incluir: nombre del software, versión, datos del desarrollador

2. Completar los **test cases** provistos por CRA:
   - CRA provee un conjunto de escenarios de prueba con datos de entrada
   - Probar que el software genera XML correcto para cada caso
   - Verificar que el software valida correctamente XML inválido

3. Enviar resultados de certificación a CRA para revisión

4. Recibir **Software Certification Number** de CRA

### 3. Testing en sandbox

Una vez certificado, CRA provee acceso al entorno de prueba (sandbox)
donde se pueden enviar returns de prueba sin efectos reales. Ver
[Endpoints de prueba](#endpoints-de-prueba-cra-sandbox).

### 4. Producción

Una vez que el testing en sandbox es exitoso, CRA autoriza el acceso
al entorno de producción. El software puede entonces transmitir returns
reales.

## Endpoints de prueba CRA (Sandbox)

### GST/HST NETFILE Test Environment

```
URL base: https://www.test.cra-arc.gc.ca/gncy/netfile/
         (proveerá CRA al completar la certificación)
```

### Endpoints esperados (documentación CRA)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/gncy/netfile/submit` | Enviar GST/HST return XML |
| GET | `/gncy/netfile/status/{transmissionId}` | Consultar estado de una transmisión |
| GET | `/gncy/netfile/confirmations/{periodo}` | Consultar confirmaciones para un período |

### Códigos de respuesta CRA

| Código | Significado | Acción |
|--------|-------------|--------|
| `ACC-001` | Return accepted | Registrar confirmación, estado → RECIBIDO_CRA |
| `ERR-101` | Invalid BN format | Corregir Business Number |
| `ERR-102` | BN not registered for GST/HST | Verificar registro CRA |
| `ERR-201` | Invalid reporting period | Corregir fechas From/To |
| `ERR-301` | Arithmetic inconsistency | Revisar cálculos de líneas |
| `ERR-401` | XML schema validation failed | Corregir estructura XML |
| `ERR-501` | Duplicate return for period | Ya se presentó este período |

### Datos de prueba para sandbox

CRA típicamente provee los siguientes datos para testing:

```json
{
  "testBusinessNumbers": [
    "123456789RT0001",  // BN de prueba — return válido
    "987654321RT0001",  // BN de prueba — genera ERR-102
    "111111111RT0001"   // BN de prueba — genera ERR-301
  ],
  "testAccessCodes": [
    "1234"  // WAC de prueba
  ]
}
```

## Flujo NETFILE end-to-end

### Estado actual (MVP)

```
Admin Panel → POST /api/admin/tax/netfile → Descarga XML
                                              ↓
                                         Admin revisa PDF
                                              ↓
                                         Admin sube XML a portal CRA
                                              ↓
                                         CRA procesa y confirma
                                              ↓
                                    Admin registra confirmación manualmente
```

### Estado futuro (API directa)

```
Admin Panel → POST /api/admin/tax/netfile → Genera XML + valida
                                              ↓
                              POST /api/admin/tax/netfile/submit → CRA API
                                              ↓
                                         CRA responde (accept/reject)
                                              ↓
                              Sistema registra FilingAttempt automáticamente
                                              ↓
                              Sistema hace poll de confirmación CRA
                                              ↓
                              Sistema actualiza estado → RECIBIDO_CRA
```

## Manejo de errores y rechazos

### Estados del ciclo de vida

```
PENDIENTE ──▶ GENERADO ──▶ REVISADO ──▶ ENVIADO ──▶ RECIBIDO_CRA
                 │                         │
                 │                         └──▶ RECHAZADO_CRA ──▶ (corregir y reenviar)
                 │
                 └──▶ ERROR (fallo técnico)
```

### Códigos de error comunes y resolución

| Código CRA | Causa probable | Resolución |
|------------|---------------|------------|
| `ERR-101` | BN mal formateado | Verificar 9 dígitos + RT0001 |
| `ERR-201` | Período inválido | Verificar fechas From/To dentro del año fiscal |
| `ERR-301` | Inconsistencia aritmética | Recalcular: 109 = 105 − 108, 112 = 109 + 110 + 111 |
| `ERR-401` | XML mal formado | Ejecutar `validateGstReturnXml()` antes de enviar |
| `ERR-501` | Return duplicado | Verificar `getFilingStatus(periodo)` — ya fue enviado |

### Penalidades por presentación tardía

Si el return se presenta después de la fecha límite, CRA aplica:

- **Penalidad base:** 5% del saldo adeudado
- **Penalidad agravada:** 10% si hubo penalidad en los últimos 3 años
- **Penalidad adicional:** 1% por cada mes completo de atraso (máx. 12 meses)
- **Intereses:** Tasa prescrita por CRA (~9% anual en 2026) + 4% sobre saldo

Usar `calculateLatePenalty()` para estimar penalidades antes de presentar.

## Referencias oficiales

- [CRA GST/HST NETFILE — Overview](https://www.canada.ca/en/revenue-agency/services/e-services/e-services-businesses/gst-hst-netfile.html)
- [CRA GST/HST NETFILE Return File Format (T619)](https://www.canada.ca/en/revenue-agency/services/e-services/e-services-businesses/gst-hst-netfile/gst-hst-netfile-return-file-format.html)
- [CRA GST/HST Return (GST34) — Form](https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/gst34-2.html)
- [CRA GST/HST Memorandum 16.3 — Late Filing Penalty](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/16-3.html)
- [CRA Prescribed Interest Rates](https://www.canada.ca/en/revenue-agency/services/tax/prescribed-interest-rates.html)
- [BC Provincial Sales Tax (PST) — eTaxBC](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst)

---

*Documento generado: 2026-08-05*
*Software: Lulu Island Flagship v9.0 — Capa 5 NETFILE*
*Certificación CRA: Pendiente*
