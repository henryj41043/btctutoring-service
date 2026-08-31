import { Package } from './package.enum';

/**
 * Server-side mirror of the frontend package definitions
 * (btctutoring-app/src/app/utils/package-config.ts). Used by the auto-renew job
 * and any server-side billing-amount snapshotting. Keep the two in sync.
 */
export interface PackageDef {
  monthlyCost: number;
  sessionsPerWeek: number;
  sessionLengthMin: number;
}

export const PACKAGE_CONFIG: Record<
  Exclude<Package, Package.CUSTOM>,
  PackageDef
> = {
  [Package.THRIVE]: {
    monthlyCost: 181,
    sessionsPerWeek: 1,
    sessionLengthMin: 30,
  },
  [Package.EXCEL]: {
    monthlyCost: 273,
    sessionsPerWeek: 1,
    sessionLengthMin: 45,
  },
  [Package.SUCCEED]: {
    monthlyCost: 362,
    sessionsPerWeek: 2,
    sessionLengthMin: 30,
  },
  [Package.ACHIEVE]: {
    monthlyCost: 546,
    sessionsPerWeek: 3,
    sessionLengthMin: 30,
  },
  [Package.VICTORY]: {
    monthlyCost: 546,
    sessionsPerWeek: 2,
    sessionLengthMin: 45,
  },
  [Package.EMPOWER]: {
    monthlyCost: 819,
    sessionsPerWeek: 3,
    sessionLengthMin: 45,
  },
  [Package.DETERMINATION]: {
    monthlyCost: 728,
    sessionsPerWeek: 2,
    sessionLengthMin: 60,
  },
  [Package.TRIUMPH]: {
    monthlyCost: 728,
    sessionsPerWeek: 4,
    sessionLengthMin: 30,
  },
  [Package.POWER_UP]: {
    monthlyCost: 1092,
    sessionsPerWeek: 3,
    sessionLengthMin: 60,
  },
  [Package.CONQUEST]: {
    monthlyCost: 1092,
    sessionsPerWeek: 4,
    sessionLengthMin: 45,
  },
  [Package.SUMMIT]: {
    monthlyCost: 1456,
    sessionsPerWeek: 4,
    sessionLengthMin: 60,
  },
  [Package.APEX]: {
    monthlyCost: 1820,
    sessionsPerWeek: 5,
    sessionLengthMin: 60,
  },
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolvePackageDef(
  pkg: string | undefined,
  override?: Partial<PackageDef> | null,
): PackageDef | null {
  if (!pkg) return null;
  if (pkg === (Package.CUSTOM as string)) {
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
  return PACKAGE_CONFIG[pkg as Exclude<Package, Package.CUSTOM>] ?? null;
}

export function weeklyCost(def: PackageDef): number {
  return round2((def.monthlyCost * 12) / 52);
}

export function perSessionCost(def: PackageDef): number {
  return round2(weeklyCost(def) / def.sessionsPerWeek);
}
