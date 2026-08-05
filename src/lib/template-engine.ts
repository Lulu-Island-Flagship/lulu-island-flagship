import type { SupabaseClient } from "@supabase/supabase-js";

// Capa 2: Template Engine — Content decoupled from code
// Renders templates by replacing {{variable}} placeholders with values.

export interface TemplateRenderResult {
  subject: string | null;
  body: string;
}

/**
 * Render a template by replacing {{variable}} placeholders with values.
 * Pure function — no DB access. The caller provides the template text.
 */
export function renderTemplateText(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return variables[key] ?? `{{${key}}}`;
  });
}

/**
 * Fetch a template from the database and render it.
 */
export async function renderTemplate(
  supabase: SupabaseClient,
  templateId: string,
  variables: Record<string, string>
): Promise<TemplateRenderResult> {
  const { data, error } = await supabase
    .from("communication_templates")
    .select("subject, body")
    .eq("template_id", templateId)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`Template not found or inactive: ${templateId}`);
  }

  return {
    subject: data.subject ? renderTemplateText(data.subject, variables) : null,
    body: renderTemplateText(data.body, variables),
  };
}
