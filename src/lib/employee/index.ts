// ─── Barrel: Employee ──────────────────────────────────────────
// v8.3 H7 (auditoría 2026-08-06): punto de entrada canónico para
// el módulo de empleado. Preferir este barrel sobre imports
// individuales a archivos employee-*.ts.
//
//   import { requireActiveEmployee } from "@/lib/employee";
//
// Los imports directos a archivos individuales siguen funcionando
// por compatibilidad.

// ─── Auth / Gate ───────────────────────────────────────────────
export { requireActiveEmployee } from "../require-active-employee";
export type { RequireActiveEmployeeResult } from "../require-active-employee";

// ─── Onboarding (wizard de primer día) ─────────────────────────
export {
  buildWelcomeScreen,
  buildDemoScreen,
  buildTeammatesScreen,
  buildFirstDayScreen,
  buildHelpScreen,
  initOnboardingProgress,
  getNextScreen,
  getPreviousScreen,
  advanceOnboardingScreen,
  canAdvance,
  canGoBack,
  ONBOARDING_SCREEN_ORDER,
  ONBOARDING_TOTAL_SCREENS,
} from "../employee-onboarding";
export type {
  OnboardingScreenId,
  OnboardingEmployeeData,
  OnboardingProgress,
  OnboardingScreenData,
} from "../employee-onboarding";

// ─── Mapper (assignment + order + quote → EmployeeService) ─────
export { mapToEmployeeService } from "../employee-service-mapper";
export type { EmployeeServiceMappingInput } from "../employee-service-mapper";

// ─── Languages ─────────────────────────────────────────────────
export {
  LANGUAGE_LEVELS,
  isValidLanguageLevels,
  hasFluentMatch,
} from "../employee-languages";
export type { LanguageLevel, LanguageLevels } from "../employee-languages";

// ─── Marketing consent ─────────────────────────────────────────
export {
  evaluateEmployeeMarketingVisibility,
  canAdminApprove,
} from "../employee-marketing";
export type {
  EmployeeMarketingFeatureType,
  EmployeeMarketingFeature,
  EmployeeMarketingVisibility,
} from "../employee-marketing";

// ─── Personal metrics ──────────────────────────────────────────
export {
  buildPersonalMetrics,
  computeTrend,
  toQualitativeRange,
  computeConsecutiveWeeksWithoutDisputes,
  formatMetricTrend,
  assertNoComparativeLeak,
} from "../employee-personal-metrics";
export type {
  EmployeePersonalMetrics,
  BuildPersonalMetricsInput,
  MetricTrend,
  QualitativeRange,
} from "../employee-personal-metrics";

// ─── Financial dashboard ───────────────────────────────────────
export {
  buildFinancialDashboard,
  computeTodayEarnings,
  computePayPeriodProjection,
  findNearestBadge,
  formatCents,
  PAY_PERIOD_DAYS,
} from "../employee-financial-dashboard";
export type {
  EmployeeFinancialDashboard,
  BuildDashboardInput,
  EmployeeLedgerEntry,
  EmployeeShift,
  BadgeProgress,
  UpcomingDeposit,
} from "../employee-financial-dashboard";
