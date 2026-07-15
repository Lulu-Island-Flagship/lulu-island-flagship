"use client";

import React, { useMemo, useState, useEffect } from "react";
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

const RULE_FIELDS: RuleFieldDef[] = [
  { key: "zone", label: "Zone", type: "enum", options: ZONES.map((z) => ({ value: z.name, label: z.name })) },
  {
    key: "dayOfWeek",
    label: "Day of week",
    type: "enum",
    options: [
      { value: "0", label: "Sunday" },
      { value: "1", label: "Monday" },
      { value: "2", label: "Tuesday" },
      { value: "3", label: "Wednesday" },
      { value: "4", label: "Thursday" },
      { value: "5", label: "Friday" },
      { value: "6", label: "Saturday" },
    ],
  },
  {
    key: "isPreferredDay",
    label: "Preferred day",
    type: "boolean",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  {
    key: "serviceType",
    label: "Service type",
    type: "enum",
    options: SERVICE_TYPES.map((t) => ({ value: t.key, label: t.label })),
  },
  {
    key: "serviceSubtype",
    label: "Service subtype",
    type: "enum",
    options: [
      ...SERVICE_SUBTYPES.home.map((s) => ({ value: s.key, label: s.label })),
      ...SERVICE_SUBTYPES.commercial.map((s) => ({ value: s.key, label: s.label })),
    ],
  },
  { key: "squareFeet", label: "Square feet", type: "number" },
  { key: "clientScore", label: "Client score", type: "number" },
  { key: "servicesCount", label: "Services count", type: "number" },
  { key: "disputesLostCount", label: "Lost disputes", type: "number" },
  {
    key: "accountType",
    label: "Account type",
    type: "enum",
    options: [
      { value: "b2c", label: "B2C" },
      { value: "b2b", label: "B2B" },
      { value: "government", label: "Government" },
    ],
  },
  {
    key: "clientType",
    label: "Client type",
    type: "enum",
    options: [
      { value: "new", label: "New" },
      { value: "returning", label: "Returning" },
      { value: "elite", label: "Elite" },
    ],
  },
  { key: "zoneDemand", label: "Zone demand (0-100)", type: "number" },
  {
    key: "organicLoad",
    label: "Organic load",
    type: "enum",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  { key: "daysSinceCleaning", label: "Days since cleaning", type: "number" },
  { key: "advanceNoticeDays", label: "Advance notice (days)", type: "number" },
];

const STRING_OPS: RuleCondition["op"][] = ["==", "!=", "in", "not_in", "contains"];
const NUMBER_OPS: RuleCondition["op"][] = ["==", "!=", ">", ">=", "<", "<="];
const BOOLEAN_OPS: RuleCondition["op"][] = ["==", "!="];

const ACTION_OPTIONS: { value: PricingRule["actionType"]; label: string; needsValue: boolean }[] = [
  { value: "price_multiplier", label: "Multiply price by", needsValue: true },
  { value: "price_add", label: "Add $ to price", needsValue: true },
  { value: "price_set", label: "Set price to $", needsValue: true },
  { value: "block", label: "Block quote", needsValue: false },
  { value: "flag_for_review", label: "Flag for review", needsValue: false },
];

function fieldDefFor(key: string): RuleFieldDef | undefined {
  return RULE_FIELDS.find((f) => f.key === key);
}

function operatorsForField(fieldKey: string): RuleCondition["op"][] {
  const field = fieldDefFor(fieldKey);
  if (!field) return STRING_OPS;
  if (field.type === "number") return NUMBER_OPS;
  if (field.type === "boolean") return BOOLEAN_OPS;
  return STRING_OPS;
}

function defaultValueForField(fieldKey: string): unknown {
  const field = fieldDefFor(fieldKey);
  if (!field) return "";
  if (field.type === "boolean") return true;
  if (field.type === "number") return 0;
  if (field.options && field.options.length > 0) return field.options[0].value;
  return "";
}

function parseValueInput(raw: string, fieldKey: string): unknown {
  const field = fieldDefFor(fieldKey);
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

function formatConditionValue(cond: RuleCondition): string {
  const field = fieldDefFor(cond.field);
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
  }, []);

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pricing-rules", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to load pricing rules");
        return;
      }
      const data = await res.json();
      setRules(((data.rules || []) as PricingRule[]).map(normalizeRule));
    } catch {
      setError("Network error");
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
        const ops = operatorsForField(patch.field);
        value = defaultValueForField(patch.field);
        next[index] = { ...current, field: patch.field, op: ops[0], value };
        return next;
      }
      next[index] = { ...current, ...patch, value };
      return next;
    });
  }

  function validateForm(): string | null {
    if (!name.trim()) return "Rule name is required";
    if (conditions.length === 0) return "At least one condition is required";
    for (const c of conditions) {
      if (!c.field || !operatorsForField(c.field).includes(c.op)) {
        return `Invalid operator for field ${c.field}`;
      }
      if (["in", "not_in"].includes(c.op) && !Array.isArray(c.value)) {
        return `Operator ${c.op} requires a list of values`;
      }
    }
    const needsValue = actionType !== "block" && actionType !== "flag_for_review";
    if (needsValue) {
      const n = Number(actionValue);
      if (actionValue === "" || Number.isNaN(n)) return "Action value must be a number";
      if (actionType === "price_multiplier" && n <= 0) return "Multiplier must be greater than 0";
    }
    const p = Number(priority);
    if (Number.isNaN(p) || p < 0 || !Number.isInteger(p)) return "Priority must be a non-negative integer";
    if (!reason.trim()) return "Reason is required for audit log";
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
        setFormError(err.error || "Failed to save rule");
        return;
      }

      resetForm();
      setIsFormOpen(false);
      await loadRules();
    } catch {
      setFormError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: PricingRule) {
    setUpdatingId(rule.id);
    const promptReason = window.prompt(
      `Reason for ${rule.isActive ? "disabling" : "enabling"} rule "${rule.name}"?`
    );
    if (!promptReason) {
      setUpdatingId(null);
      return;
    }

    try {
      const res = await fetch("/api/admin/pricing-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: rule.id,
          is_active: !rule.isActive,
          reason: promptReason,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to update rule");
        return;
      }

      await loadRules();
    } catch {
      setError("Network error");
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteRule(rule: PricingRule) {
    const deleteReason = window.prompt(`Reason for deleting rule "${rule.name}"?`);
    if (!deleteReason) return;

    setDeletingId(rule.id);
    try {
      const res = await fetch(
        `/api/admin/pricing-rules?id=${encodeURIComponent(rule.id)}&reason=${encodeURIComponent(deleteReason)}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to delete rule");
        return;
      }
      await loadRules();
    } catch {
      setError("Network error");
    } finally {
      setDeletingId(null);
    }
  }

  function renderConditionValueInput(condition: RuleCondition, index: number) {
    const field = fieldDefFor(condition.field);
    const opAllowsList = ["in", "not_in"].includes(condition.op);

    if (opAllowsList) {
      const options = field?.options || [];
      const selected = Array.isArray(condition.value)
        ? condition.value.map((v) => valueToString(v))
        : [];
      return (
        <select
          multiple
          aria-label={`Valores para la condición ${field?.label || condition.field}`}
          value={selected}
          onChange={(e) => {
            const values = Array.from(e.target.selectedOptions).map((o) =>
              parseValueInput(o.value, condition.field)
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
          aria-label={`Valor para la condición ${field?.label || condition.field}`}
          value={valueToString(condition.value)}
          onChange={(e) => updateCondition(index, { value: parseValueInput(e.target.value, condition.field) })}
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
        aria-label={`Valor para la condición ${field?.label || condition.field}`}
        value={valueToString(condition.value)}
        onChange={(e) => updateCondition(index, { value: parseValueInput(e.target.value, condition.field) })}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink">Pricing Rules</h1>
          <p className="text-sm text-gray-500">
            {rules.filter((r) => r.isActive).length} active of {rules.length}
          </p>
        </div>
        <button
          onClick={openNewForm}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90"
        >
          <Plus className="w-4 h-4" />
          New rule
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
            <h3 className="text-sm font-semibold text-amber-800">Detected conflicts between active rules</h3>
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
              {editingRuleId ? "Edit pricing rule" : "Create pricing rule"}
            </h2>
            <button
              onClick={() => {
                setIsFormOpen(false);
                resetForm();
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
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
                <label htmlFor="pricing-rule-name" className="text-sm font-medium text-gray-700">Rule name</label>
                <input
                  id="pricing-rule-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Weekend surcharge"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pricing-rule-description" className="text-sm font-medium text-gray-700">Description</label>
                <input
                  id="pricing-rule-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief explanation for audit log"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">Conditions</label>
                {conditions.length > 1 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Match</span>
                    <select
                      aria-label="Modo de coincidencia de condiciones (todas o cualquiera)"
                      value={conditionGroup}
                      onChange={(e) => setConditionGroup(e.target.value as "and" | "or")}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                    >
                      <option value="and">All (AND)</option>
                      <option value="or">Any (OR)</option>
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
                        aria-label={`Campo de la condición ${index + 1}`}
                        value={condition.field}
                        onChange={(e) => updateCondition(index, { field: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                      >
                        {RULE_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <select
                        aria-label={`Operador de la condición ${index + 1}`}
                        value={condition.op}
                        onChange={(e) => updateCondition(index, { op: e.target.value as RuleCondition["op"] })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                      >
                        {operatorsForField(condition.field).map((op) => (
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
                          <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple values.</p>
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeCondition(index)}
                        disabled={conditions.length === 1}
                        className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
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
                Add condition
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="pricing-rule-action" className="text-sm font-medium text-gray-700">Action</label>
                <select
                  id="pricing-rule-action"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as PricingRule["actionType"])}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                >
                  {ACTION_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {actionType !== "block" && actionType !== "flag_for_review" && (
                <div className="space-y-1.5">
                  <label htmlFor="pricing-rule-value" className="text-sm font-medium text-gray-700">Value</label>
                  <input
                    id="pricing-rule-value"
                    type="number"
                    step={actionType === "price_multiplier" ? "0.01" : "1"}
                    value={actionValue}
                    onChange={(e) => setActionValue(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  />
                  {actionType === "price_multiplier" && (
                    <p className="text-xs text-gray-500">Use 0.90 for 10% discount, 1.20 for 20% surcharge.</p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="pricing-rule-priority" className="text-sm font-medium text-gray-700">Priority</label>
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
                Allow additional rules to apply after this one
              </label>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pricing-rule-audit-reason" className="text-sm font-medium text-gray-700">Audit reason</label>
              <input
                id="pricing-rule-audit-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you creating/editing this rule?"
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
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                aria-label={editingRuleId ? "Guardar cambios de la regla" : "Crear regla de precio"}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" />
                {editingRuleId ? "Save changes" : "Create rule"}
              </button>
            </div>
          </form>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Tag className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No pricing rules found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Rule</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Conditions</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
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
                        ? "OR"
                        : "AND";

                  return (
                    <React.Fragment key={rule.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-brand-ink">{rule.name}</div>
                          <div className="text-xs text-gray-500">{rule.description}</div>
                          {!rule.maxApplicable && (
                            <span className="inline-flex mt-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">
                              Stop chain
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-xs text-gray-700 space-y-1">
                            {conditionList.map((c, i) => (
                              <div key={i}>
                                <span className="font-medium">{RULE_FIELDS.find((f) => f.key === c.field)?.label || c.field}</span>{" "}
                                <span className="text-gray-500">{c.op}</span>{" "}
                                <span>{formatConditionValue(c)}</span>
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
                            {ACTION_OPTIONS.find((a) => a.value === rule.actionType)?.label || rule.actionType}
                            {rule.actionValue !== undefined && rule.actionValue !== null && `: ${rule.actionValue}`}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-gray-600">{rule.priority}</td>
                        <td className="px-4 py-3 align-top">
                          {rule.isActive ? (
                            <span className="text-green-600 text-xs font-medium">Active</span>
                          ) : (
                            <span className="text-gray-400 text-xs font-medium">Inactive</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleRule(rule)}
                              disabled={updatingId === rule.id}
                              className="text-gray-500 hover:text-brand-navy disabled:opacity-50"
                              title={rule.isActive ? "Disable" : "Enable"}
                            >
                              {updatingId === rule.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : rule.isActive ? (
                                <ToggleRight className="w-6 h-6 text-green-600" />
                              ) : (
                                <ToggleLeft className="w-6 h-6 text-gray-400" />
                              )}
                            </button>
                            <button
                              onClick={() => openEditForm(rule)}
                              className="text-gray-500 hover:text-brand-navy"
                              title="Edit"
                            >
                              <Tag className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteRule(rule)}
                              disabled={deletingId === rule.id}
                              className="text-gray-500 hover:text-red-500 disabled:opacity-50"
                              title="Delete"
                            >
                              {deletingId === rule.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
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
                              title="Audit history"
                            >
                              <History className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {showAuditForRule === rule.id && (
                        <tr>
                          <td colSpan={6} className="bg-gray-50 px-4 py-3">
                            <div className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
                              <History className="w-3 h-3" /> Audit history
                            </div>
                            {auditLogs.length === 0 ? (
                              <p className="text-xs text-gray-500">No audit entries found.</p>
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
    </div>
  );
}
