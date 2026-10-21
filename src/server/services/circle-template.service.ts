import { CIRCLE_TEMPLATES, CircleTemplate } from "@/data/circleTemplates";

/**
 * Lightweight analytics counters for template usage. Kept in-memory and
 * best-effort — template selection must never fail because tracking failed.
 */
const templateUseCounts = new Map<string, number>();

/**
 * Return every available circle template.
 *
 * Templates are the canonical source for the create-circle form defaults, so
 * this list is returned in a stable order for a predictable UI.
 */
export function listTemplates(): CircleTemplate[] {
  return CIRCLE_TEMPLATES;
}

/** Look up a single template by its slug-style id. */
export function getTemplateById(id: string): CircleTemplate | null {
  return CIRCLE_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** Record that a template was used to pre-populate a new circle. */
export function trackTemplateUsage(id: string): void {
  templateUseCounts.set(id, (templateUseCounts.get(id) ?? 0) + 1);
}

/** Current usage counts per template id, for analytics surfaces. */
export function getTemplateUsage(): Record<string, number> {
  return Object.fromEntries(templateUseCounts);
}
