"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  AlertCircle,
  ToggleRight,
  ToggleLeft,
  Tag,
  Plus,
  Trash2,
  Save,
  X,
  AlertTriangle,
  History,
} from "lucide-react";
import { ZONES, SERVICE_TYPES, SERVICE_SUBTYPES } from "@/lib/pricing";
import { detectRuleConflicts, type PricingRule, type RuleCondition } from "@/lib/rules";
import ConfirmActionModal from "@/components/admin/ConfirmActionModal";

interface RuleAuditEntry {
  id: string;
  rule_id?: string;
  reason: string;
  created_at: string;
  changed_by?: string;
}

interface RuleFieldDef {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  options?: { value: string; label: string }[];
}

type TFunc = ReturnType<typeof useTranslations>;

function buildRuleFields(t: TFunc): RuleFieldDef[] {
  return [
    { key: "zone", label: t("ruleFields.zone"), type: "enum", options: ZONES.map((z) => ({ value: z.name, label: z.name })) },
    {
      key: "dayOfWeek",
      label: t("ruleFields.dayOfWeek"),
      type: "enum",
      options: [
        { value: "0", label: t("ruleFieldOptions.dayOfWeek.0") },
        { value: "1", label: t("ruleFieldOptions.dayOfWeek.1") },
        { value: "2", label: t("ruleFieldOptions.dayOfWeek.2") },
        { value: "3", label: t("ruleFieldOptions.dayOfWeek.3") },
        { value: "4", label: t("ruleFieldOptions.dayOfWeek.4") },
        { value: "5", label: t("ruleFieldOptions.dayOfWeek.5") },
        { value: "6", label: t("ruleFieldOptions.dayOfWeek.6") },
      ],
    },
    {
      key: "isPreferredDay",
      label: t("ruleFields.isPreferredDay"),
      type: "boolean",
      options: [
        { value: "true", label: t("ruleFieldOptions.isPreferredDay.true") },
        { value: "false", label: t("ruleFieldOptions.isPreferredDay.false") },
      ],
    },
    {
      key: "serviceType",
      label: t("ruleFields.serviceType"),
      type: "enum",
      options: SERVICE_TYPES.map((s) => ({ value: s.key, label: s.label })),
    },
    {
      key: "serviceSubtype",
      label: t("ruleFields.serviceSubtype"),
      type: "enum",
      options: [
        ...SERVICE_SUBTYPES.home.map((s) => ({ value: s.key, label: s.label })),
        ...SERVICE_SUBTYPES.commercial.map((s) => ({ value: s.key, label: s.label })),
      ],
    },
    { key: "squareFeet", label: t("ruleFields.squareFeet"), type: "number" },
    { key: "clientScore", label: t("ruleFields.clientScore"), type: "number" },
    { key: "servicesCount", label: t("ruleFields.servicesCount"), type: "number" },
    { key: "disputesLostCount", label: t("ruleFields.disputesLostCount"), type: "number" },
    {
      key: "accountType",
      label: t("ruleFields.accountType"),
      type: "enum",
      options: [
        { value: "b2c", label: t("ruleFieldOptions.accountType.b2c") },
        { value: "b2b", label: t("ruleFieldOptions.accountType.b2b") },
        { value: "government", label: t("ruleFieldOptions.accountType.government") },
      ],
    },
    {
      key: "clientType",
      label: t("ruleFields.clientType"),
      type: "enum",
      options: [
        { value: "new", label: t("ruleFieldOptions.clientType.new") },
        { value: "returning", label: t("ruleFieldOptions.clientType.returning") },
        { value: "elite", label: t("ruleFieldOptions.clientType.elite") },
      ],
    },
    { key: "zoneDemand", label: t("ruleFields.zoneDemand"), type: "number" },
    {
      key: "organicLoad",
      label: t("ruleFields.organicLoad"),
      type: "enum",
      options: [
        { value: "low", label: t("ruleFieldOptions.organicLoad.low") },
        { value: "medium", label: t("ruleFieldOptions.organicLoad.medium") },
        { value: "high", label: t("ruleFieldOptions.organicLoad.high") },
      ],
    },
    { key: "daysSinceCleaning", label: t("ruleFields.daysSinceCleaning"), type: "number" },
    { key: "advanceNoticeDays", label: t("ruleFields.advanceNoticeDays"), type: "number" },
  ];
}

const STRING_OPS: RuleCondition["op"][] = ["==", "!=", "in", "not_in", "contains"];
const NUMBER_OPS: RuleCondition["op"][] = ["==", "!=", ">", ">=", "<", "<="];
const BOOLEAN_OPS: RuleCondition["op"][] = ["==", "!="];

function buildActionOptions(
  t: TFunc
): { value: PricingRule["actionType"]; label: string; needsValue: boolean }[] {
  return [
    { value: "price_multiplier", label: t("actionOptions.priceMultiplier"), needsValue: true },
    { value: "price_add", label: t("actionOptions.priceAdd"), needsValue: true },
    { value: "price_set", label: t("actionOptions.priceSet"), needsValue: true },
    { value: "block", label: t("actionOptions.block"), needsValue: false },
    { value: "flag_for_review", label: t("actionOptions.flagForReview"), needsValue: false },
  ];
}

function operatorsForField(fieldKey: string, fields: RuleFieldDef[]): RuleCondition["op"][] {
  const field = fields.find((f) => f.key === fieldKey);
  if (!field) return STRING_OPS;
  if (field.type === "number") return NUMBER_OPS;
  if (field.type === "boolean") return BOOLEAN_OPS;
  return STRING_OPS;
}

function defaultValueForField(fieldKey: string, fields: RuleFieldDef[]): unknown {
  const field = fields.find((f) => f.key === fieldKey);
  if (!field) return "";
  if (field.type === "boolean") return true;
  if (field.type === "number") return 0;
  if (field.options && field.options.length > 0) return field.options[0].value;
  return "";
}

function parseValueInput(raw: string, fieldKey: string, fields: RuleFieldDef[]): unknown {
  const field = fields.find((f) => f.key === fieldKey);
  if (!field) return raw;
  if (field.type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  if (field.type === "boolean") {
    return raw === "true";
  }
  return raw;
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatConditionValue(cond: RuleCondition, fields: RuleFieldDef[]): string {
  const field = fields.find((f) => f.key === cond.field);
  if (Array.isArray(cond.value)) {
    return cond.value
      .map((v) => {
        const str = valueToString(v);
        if (field?.options) {
          const opt = field.options.find((o) => o.value === str);
          return opt ? opt.label : str;
        }
        return str;
      })
      .join(", ");
  }
  const str = valueToString(cond.value);
  if (field?.options) {
    const opt = field.options.find((o) => o.value === str);
    if (opt) return opt.label;
  }
  return str;
}

function normalizeRule(raw: PricingRule): PricingRule {
  return {
    ...raw,
    conditionJson: (raw as unknown as { condition_json?: PricingRule["conditionJson"] }).condition_json || raw.conditionJson,
    isActive: (raw as unknown as { is_active?: boolean }).is_active ?? raw.isActive,
    maxApplicable: (raw as unknown as { max_applicable?: boolean }).max_applicable ?? raw.maxApplicable,
    actionType: (raw as unknown as { action_type?: PricingRule["actionType"] }).action_type || raw.actionType,
    actionValue: (raw as unknown as { action_value?: number }).action_value ?? raw.actionValue,
  };
}

export default function AdminPricingRulesClient() {
  const t = useTranslations("admin.pricingRules");
  const ruleFields = useMemo(() => buildRuleFields(t), [t]);
  const actionOptions = useMemo(() => buildActionOptions(t), [t]);

  function fieldDefFor(key: string): RuleFieldDef | undefined {
    return ruleFields.find((f) => f.key === key);
  }

  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<RuleAuditEntry[]>([]);
  const [showAuditForRule, setShowAuditForRule] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  // 2026-07-24 fix: reemplaza los dos window.prompt() (razón de
  // activar/desactivar y razón de eliminar) por ConfirmActionModal — guarda
  // la regla pendiente de confirmar para cada acción.
  const [toggleTargetRule, setToggleTargetRule] = useState<PricingRule | null>(null);
  const [deleteTargetRule, setDeleteTargetRule] = useState<PricingRule | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conditions, setConditions] = useState<RuleCondition[]>([
    { field: "zone", op: "==", value: "Richmond" },
  ]);
  const [conditionGroup, setConditionGroup] = useState<"and" | "or">("and");
  const [actionType, setActionType] = useState<PricingRule["actionType"]>("price_add");
  const [actionValue, setActionValue] = useState<string>("0");
  const [priority, setPriority] = useState<string>("0");
  const [maxApplicable, setMaxApplicable] = useState(true);
  const [reason, setReason] = useState("");

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pricing-rules", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("errors.loadFailed"));
        return;
      }
      const data = await res.json();
      setRules(((data.rules || []) as PricingRule[]).map(normalizeRule));
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  async function loadAuditLogs(ruleId: string) {
    try {
      const res = await fetch(`/api/admin/pricing-rules/audit?ruleId=${encodeURIComponent(ruleId)}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setAuditLogs((data.logs || []) as RuleAuditEntry[]);
    } catch {
      setAuditLogs([]);
    }
  }

  const conflicts = useMemo(() => detectRuleConflicts(rules), [rules]);

  function resetForm() {
    setName("");
    setDescription("");
    setConditions([{ field: "zone", op: "==", value: "Richmond" }]);
    setConditionGroup("and");
    setActionType("price_add");
    setActionValue("0");
    setPriority("0");
    setMaxApplicable(true);
    setReason("");
    setFormError("");
    setEditingRuleId(null);
  }

  function openNewForm() {
    resetForm();
    setIsFormOpen(true);
  }

  function openEditForm(rule: PricingRule) {
    setEditingRuleId(rule.id);
    setName(rule.name);
    setDescription(rule.description || "");
    const cond = rule.conditionJson;
    if ("field" in cond) {
      setConditions([cond as RuleCondition]);
      setConditionGroup("and");
    } else {
      const group = cond as { and?: RuleCondition[]; or?: RuleCondition[] };
      if (group.and && group.and.length > 0) {
        setConditions(group.and);
        setConditionGroup("and");
      } else if (group.or && group.or.length > 0) {
        setConditions(group.or);
        setConditionGroup("or");
      } else {
        setConditions([{ field: "zone", op: "==", value: "Richmond" }]);
        setConditionGroup("and");
      }
    }
    setActionType(rule.actionType);
    setActionValue(rule.actionValue !== undefined && rule.actionValue !== null ? String(rule.actionValue) : "");
    setPriority(String(rule.priority));
    setMaxApplicable(rule.maxApplicable);
    setReason("");
    setFormError("");
    setIsFormOpen(true);
  }

  function addCondition() {
    setConditions((prev) => [...prev, { field: "zone", op: "==", value: "Richmond" }]);
  }

  function removeCondition(index: number) {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCondition(index: number, patch: Partial<RuleCondition>) {
    setConditions((prev) => {
      const next = [...prev];
      const current = next[index];
      let value: unknown = patch.value !== undefined ? patch.value : current.value;
      if (patch.field && patch.field !== current.field) {
        const ops = operatorsForField(patch.field, ruleFields);
        value = defaultValueForField(patch.field, ruleFields);
        next[index] = { ...current, field: patch.field, op: ops[0], value };
        return next;
      }
      next[index] = { ...current, ...patch, value };
      return next;
    });
  }

  function validateForm(): string | null {
    if (!name.trim()) return t("validation.nameRequired");
    if (conditions.length === 0) return t("validation.conditionsRequired");
    for (const c of conditions) {
      if (!c.field || !operatorsForField(c.field, ruleFields).includes(c.op)) {
        return t("validation.invalidOperator", { field: c.field });
      }
      if (["in", "not_in"].includes(c.op) && !Array.isArray(c.value)) {
        return t("validation.listRequired", { op: c.op });
      }
    }
    const needsValue = actionType !== "block" && actionType !== "flag_for_review";
    if (needsValue) {
      const n = Number(actionValue);
      if (actionValue === "" || Number.isNaN(n)) return t("validation.actionValueNumber");
      if (actionType === "price_multiplier" && n <= 0) return t("validation.multiplierPositive");
    }
    const p = Number(priority);
    if (Number.isNaN(p) || p < 0 || !Number.isInteger(p)) return t("validation.priorityInteger");
    if (!reason.trim()) return t("validation.reasonRequired");
    return null;
  }

  function buildConditionJson(): Record<string, unknown> {
    if (conditions.length === 1) {
      return conditions[0] as unknown as Record<string, unknown>;
    }
    return { [conditionGroup]: conditions } as unknown as Record<string, unknown>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError("");

    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      conditionJson: buildConditionJson(),
      actionType,
      priority: Number(priority),
      maxApplicable,
      reason: reason.trim(),
    };

    const needsValue = actionType !== "block" && actionType !== "flag_for_review";
    if (needsValue) {
      payload.actionValue = Number(actionValue);
    }

    try {
      const res = await fetch("/api/admin/pricing-rules", {
        method: editingRuleId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editingRuleId ? { ...payload, id: editingRuleId } : payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setFormError(err.error || t("errors.saveFailed"));
        return;
      }

      resetForm();
      setIsFormOpen(false);
      await loadRules();
    } catch {
      setFormError(t("errors.network"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: PricingRule, reason: string) {
    setUpdatingId(rule.id);
    try {
      const res = await fetch("/api/admin/pricing-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: rule.id,
          is_active: !rule.isActive,
          reason,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("errors.toggleFailed"));
      }

      await loadRules();
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteRule(rule: PricingRule, reason: string) {
    setDeletingId(rule.id);
    try {
      const res = await fetch(
        `/api/admin/pricing-rules?id=${encodeURIComponent(rule.id)}&reason=${encodeURIComponent(reason)}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("errors.deleteFailed"));
      }
      await loadRules();
    } finally {
      setDeletingId(null);
    }
  }

  function renderConditionValueInput(condition: RuleCondition, index: number) {
    const field = fieldDefFor(condition.field);
    const opAllowsList = ["in", "not_in"].includes(condition.op);
    const fieldLabel = field?.label || condition.field;

    if (opAllowsList) {
      const options = field?.options || [];
      const selected = Array.isArray(condition.value)
        ? condition.value.map((v) => valueToString(v))
        : [];
      return (
        <select
          multiple
          aria-label={t("form.conditionValuesAria", { field: fieldLabel })}
          value={selected}
          onChange={(e) => {
            const values = Array.from(e.target.selectedOptions).map((o) =>
              parseValueInput(o.value, condition.field, ruleFields)
            );
            updateCondition(index, { value: values });
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold min-h-[5rem]"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    if (field?.options && field.options.length > 0) {
      return (
        <select
          aria-label={t("form.conditionValueAria", { field: fieldLabel })}
          value={valueToString(condition.value)}
          onChange={(e) => updateCondition(index, { value: parseValueInput(e.target.value, condition.field, ruleFields) })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type={field?.type === "number" ? "number" : "text"}
        aria-label={t("form.conditionValueAria", { field: fieldLabel })}
        value={valueToString(condition.value)}
        onChange={(e) => updateCondition(index, { value: parseValueInput(e.target.value, condition.field, ruleFields) })}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold-dark" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">{t("title")}</h1>
          <p className="text-sm text-gray-500">
            {t("activeOfTotal", { active: rules.filter((r) => r.isActive).length, total: rules.length })}
          </p>
        </div>
        <button
          onClick={openNewForm}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90"
        >
          <Plus className="w-4 h-4" />
          {t("newRule")}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-800">{t("conflicts.title")}</h3>
          </div>
          <ul className="list-disc list-inside text-xs text-amber-800 space-y-1">
            {conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {isFormOpen && (
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-brand-ink">
              {editingRuleId ? t("form.editTitle") : t("form.createTitle")}
            </h2>
            <button
              onClick={() => {
                setIsFormOpen(false);
                resetForm();
              }}
              aria-label={t("form.closeAria")}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {formError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm">{formError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="pricing-rule-name" className="text-sm font-medium text-gray-700">{t("form.nameLabel")}</label>
                <input
                  id="pricing-rule-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("form.namePlaceholder")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pricing-rule-description" className="text-sm font-medium text-gray-700">{t("form.descriptionLabel")}</label>
                <input
                  id="pricing-rule-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("form.descriptionPlaceholder")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">{t("form.conditionsLabel")}</label>
                {conditions.length > 1 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">{t("form.matchLabel")}</span>
                    <select
                      aria-label={t("form.matchModeAria")}
                      value={conditionGroup}
                      onChange={(e) => setConditionGroup(e.target.value as "and" | "or")}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                    >
                      <option value="and">{t("form.matchAll")}</option>
                      <option value="or">{t("form.matchAny")}</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {conditions.map((condition, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start bg-gray-50 rounded-lg p-3"
                  >
                    <div className="sm:col-span-3">
                      <select
                        aria-label={t("form.conditionFieldAria", { index: index + 1 })}
                        value={condition.field}
                        onChange={(e) => updateCondition(index, { field: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                      >
                        {ruleFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <select
                        aria-label={t("form.conditionOperatorAria", { index: index + 1 })}
                        value={condition.op}
                        onChange={(e) => updateCondition(index, { op: e.target.value as RuleCondition["op"] })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                      >
                        {operatorsForField(condition.field, ruleFields).map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-6">
                      <div className="text-sm">
                        {renderConditionValueInput(condition, index)}
                        {["in", "not_in"].includes(condition.op) && (
                          <p className="text-xs text-gray-500 mt-1">{t("form.multiSelectHint")}</p>
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeCondition(index)}
                        disabled={conditions.length === 1}
                        aria-label={t("form.removeConditionAria", { index: index + 1 })}
                        className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addCondition}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-navy hover:text-brand-navy/80"
              >
                <Plus className="w-4 h-4" />
                {t("form.addCondition")}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="pricing-rule-action" className="text-sm font-medium text-gray-700">{t("form.actionLabel")}</label>
                <select
                  id="pricing-rule-action"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as PricingRule["actionType"])}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                >
                  {actionOptions.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {actionType !== "block" && actionType !== "flag_for_review" && (
                <div className="space-y-1.5">
                  <label htmlFor="pricing-rule-value" className="text-sm font-medium text-gray-700">{t("form.valueLabel")}</label>
                  <input
                    id="pricing-rule-value"
                    type="number"
                    step={actionType === "price_multiplier" ? "0.01" : "1"}
                    value={actionValue}
                    onChange={(e) => setActionValue(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  />
                  {actionType === "price_multiplier" && (
                    <p className="text-xs text-gray-500">{t("form.multiplierHint")}</p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="pricing-rule-priority" className="text-sm font-medium text-gray-700">{t("form.priorityLabel")}</label>
                <input
                  id="pricing-rule-priority"
                  type="number"
                  min={0}
                  step={1}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="maxApplicable"
                type="checkbox"
                checked={maxApplicable}
                onChange={(e) => setMaxApplicable(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-gold"
              />
              <label htmlFor="maxApplicable" className="text-sm text-gray-700">
                {t("form.maxApplicableLabel")}
              </label>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pricing-rule-audit-reason" className="text-sm font-medium text-gray-700">{t("form.auditReasonLabel")}</label>
              <input
                id="pricing-rule-audit-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("form.auditReasonPlaceholder")}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  resetForm();
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("form.cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                aria-label={editingRuleId ? t("form.saveChangesAria") : t("form.createRuleAria")}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" />
                {editingRuleId ? t("form.saveChanges") : t("form.createRule")}
              </button>
            </div>
          </form>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Tag className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">{t("empty.noRules")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.rule")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.conditions")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.action")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.priority")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.status")}</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-gray-600">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rules.map((rule) => {
                  const conditionList: RuleCondition[] =
                    "field" in rule.conditionJson
                      ? [rule.conditionJson as RuleCondition]
                      : (rule.conditionJson as { and?: RuleCondition[]; or?: RuleCondition[] }).and ||
                        (rule.conditionJson as { and?: RuleCondition[]; or?: RuleCondition[] }).or ||
                        [];
                  const groupOperator =
                    "field" in rule.conditionJson
                      ? ""
                      : (rule.conditionJson as { and?: RuleCondition[]; or?: RuleCondition[] }).or
                        ? t("conditionsGroup.or")
                        : t("conditionsGroup.and");

                  return (
                    <React.Fragment key={rule.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-brand-ink">{rule.name}</div>
                          <div className="text-xs text-gray-500">{rule.description}</div>
                          {!rule.maxApplicable && (
                            <span className="inline-flex mt-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">
                              {t("stopChain")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-xs text-gray-700 space-y-1">
                            {conditionList.map((c, i) => (
                              <div key={i}>
                                <span className="font-medium">{fieldDefFor(c.field)?.label || c.field}</span>{" "}
                                <span className="text-gray-500">{c.op}</span>{" "}
                                <span>{formatConditionValue(c, ruleFields)}</span>
                                {i < conditionList.length - 1 && (
                                  <span className="ml-1 text-[10px] uppercase text-gray-400 font-semibold">
                                    {groupOperator}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
                            {actionOptions.find((a) => a.value === rule.actionType)?.label || rule.actionType}
                            {rule.actionValue !== undefined && rule.actionValue !== null && `: ${rule.actionValue}`}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-gray-600">{rule.priority}</td>
                        <td className="px-4 py-3 align-top">
                          {rule.isActive ? (
                            <span className="text-green-600 text-xs font-medium">{t("status.active")}</span>
                          ) : (
                            <span className="text-gray-400 text-xs font-medium">{t("status.inactive")}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setToggleTargetRule(rule)}
                              disabled={updatingId === rule.id}
                              className="text-gray-500 hover:text-brand-navy disabled:opacity-50"
                              title={rule.isActive ? t("rowActions.disableTitle") : t("rowActions.enableTitle")}
                              aria-label={
                                rule.isActive
                                  ? t("rowActions.disableAria", { name: rule.name })
                                  : t("rowActions.enableAria", { name: rule.name })
                              }
                            >
                              {updatingId === rule.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                              ) : rule.isActive ? (
                                <ToggleRight className="w-6 h-6 text-green-600" aria-hidden="true" />
                              ) : (
                                <ToggleLeft className="w-6 h-6 text-gray-400" aria-hidden="true" />
                              )}
                            </button>
                            <button
                              onClick={() => openEditForm(rule)}
                              className="text-gray-500 hover:text-brand-navy"
                              title={t("rowActions.editTitle")}
                              aria-label={t("rowActions.editAria", { name: rule.name })}
                            >
                              <Tag className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => setDeleteTargetRule(rule)}
                              disabled={deletingId === rule.id}
                              className="text-gray-500 hover:text-red-500 disabled:opacity-50"
                              title={t("rowActions.deleteTitle")}
                              aria-label={t("rowActions.deleteAria", { name: rule.name })}
                            >
                              {deletingId === rule.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              )}
                            </button>
                            <button
                              onClick={() => {
                                if (showAuditForRule === rule.id) {
                                  setShowAuditForRule(null);
                                } else {
                                  setShowAuditForRule(rule.id);
                                  loadAuditLogs(rule.id);
                                }
                              }}
                              className="text-gray-500 hover:text-brand-navy"
                              title={t("rowActions.auditTitle")}
                              aria-label={t("rowActions.auditAria", { name: rule.name })}
                            >
                              <History className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {showAuditForRule === rule.id && (
                        <tr>
                          <td colSpan={6} className="bg-gray-50 px-4 py-3">
                            <div className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
                              <History className="w-3 h-3" /> {t("audit.title")}
                            </div>
                            {auditLogs.length === 0 ? (
                              <p className="text-xs text-gray-500">{t("audit.empty")}</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {auditLogs.map((log) => (
                                  <li key={log.id} className="text-xs text-gray-600">
                                    <span className="font-medium">{new Date(log.created_at).toLocaleString()}</span>{" "}
                                    — {log.reason}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toggleTargetRule && (
        <ConfirmActionModal
          title={
            toggleTargetRule.isActive
              ? t("toggleModal.disableTitle", { name: toggleTargetRule.name })
              : t("toggleModal.enableTitle", { name: toggleTargetRule.name })
          }
          confirmLabel={toggleTargetRule.isActive ? t("toggleModal.disableConfirm") : t("toggleModal.enableConfirm")}
          danger={toggleTargetRule.isActive}
          fields={[
            {
              key: "reason",
              label: toggleTargetRule.isActive
                ? t("toggleModal.disableReasonLabel")
                : t("toggleModal.enableReasonLabel"),
              autoFocus: true,
            },
          ]}
          onCancel={() => setToggleTargetRule(null)}
          onConfirm={async (values) => {
            await toggleRule(toggleTargetRule, values.reason);
            setToggleTargetRule(null);
          }}
        />
      )}

      {deleteTargetRule && (
        <ConfirmActionModal
          title={t("deleteModal.title", { name: deleteTargetRule.name })}
          message={t("deleteModal.message")}
          confirmLabel={t("deleteModal.confirm")}
          danger
          fields={[
            {
              key: "reason",
              label: t("deleteModal.reasonLabel"),
              autoFocus: true,
            },
          ]}
          onCancel={() => setDeleteTargetRule(null)}
          onConfirm={async (values) => {
            await deleteRule(deleteTargetRule, values.reason);
            setDeleteTargetRule(null);
          }}
        />
      )}
    </div>
  );
}
