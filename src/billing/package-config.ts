/**
 * Package definitions resolve from the admin-managed catalog (the Packages
 * DynamoDB table) — no more hardcoded config. Callers fetch the catalog once
 * per run/request (PackagesService.getCatalog) and thread it through these
 * pure helpers. Mirror of the frontend helpers
 * (btctutoring-app/src/app/utils/package-config.ts). Keep the two in sync.
 */

/**
 * The one package that never lives in the catalog: a code-level marker for
 * per-student overrides (custom_monthly_cost / custom_sessions_per_week /
 * custom_session_length_min).
 */
export const CUSTOM_PACKAGE = 'Custom';

export interface PackageDef {
  monthlyCost: number;
  sessionsPerWeek: number;
  sessionLengthMin: number;
}

/**
 * Package name → definition, built from the Packages table. Retired entries
 * are INCLUDED — they keep resolving for students still on them; `retired`
 * only governs whether a package is offered for NEW selections.
 */
export type PackageCatalog = Record<string, PackageDef & { retired?: boolean }>;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolvePackageDef(
  pkg: string | undefined,
  catalog: PackageCatalog,
  override?: Partial<PackageDef> | null,
): PackageDef | null {
  if (!pkg) return null;
  if (pkg === CUSTOM_PACKAGE) {
    if (
      override &&
      override.monthlyCost != null &&
      override.sessionsPerWeek != null &&
      override.sessionLengthMin != null
    ) {
      return override as PackageDef;
    }
    return null;
  }
  const entry = catalog[pkg];
  if (!entry) return null;
  return {
    monthlyCost: entry.monthlyCost,
    sessionsPerWeek: entry.sessionsPerWeek,
    sessionLengthMin: entry.sessionLengthMin,
  };
}

export function weeklyCost(def: PackageDef): number {
  return round2((def.monthlyCost * 12) / 52);
}

export function perSessionCost(def: PackageDef): number {
  return round2(weeklyCost(def) / def.sessionsPerWeek);
}
