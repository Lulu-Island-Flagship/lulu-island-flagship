// Shared tax types — imported by TaxDashboard and TaxFilingModal
// to avoid circular dependency that breaks webpack build.

export type TaxObligationType = "GST" | "T4" | "T4A" | "ROE" | "PST";

export interface TaxObligationSummary {
  type: TaxObligationType;
  label: string;
  period: string;
  deadline: string;
  daysUntilDeadline: number;
  status: "upcoming" | "due_soon" | "overdue" | "filed";
  filingStatus: string | null;
}

export interface SubmissionRecord {
  id: string;
  type: TaxObligationType;
  period: string;
  year: number;
  filedAt: string | null;
  status: string;
  reference: string | null;
  xmlDownloadUrl: string | null;
}
