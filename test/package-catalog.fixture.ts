import { PackageCatalog } from '../src/billing/package-config';

/**
 * The seeded catalog (mirrors scripts/seed-packages.ts) for specs that need
 * package definitions now that PACKAGE_CONFIG is a DynamoDB table.
 */
export const TEST_CATALOG: PackageCatalog = {
  Thrive: { monthlyCost: 181, sessionsPerWeek: 1, sessionLengthMin: 30 },
  Excel: { monthlyCost: 273, sessionsPerWeek: 1, sessionLengthMin: 45 },
  Succeed: { monthlyCost: 362, sessionsPerWeek: 2, sessionLengthMin: 30 },
  Achieve: { monthlyCost: 546, sessionsPerWeek: 3, sessionLengthMin: 30 },
  Victory: { monthlyCost: 546, sessionsPerWeek: 2, sessionLengthMin: 45 },
  Empower: { monthlyCost: 819, sessionsPerWeek: 3, sessionLengthMin: 45 },
  Determination: { monthlyCost: 728, sessionsPerWeek: 2, sessionLengthMin: 60 },
  Triumph: { monthlyCost: 728, sessionsPerWeek: 4, sessionLengthMin: 30 },
  'Power-Up': { monthlyCost: 1092, sessionsPerWeek: 3, sessionLengthMin: 60 },
  Conquest: { monthlyCost: 1092, sessionsPerWeek: 4, sessionLengthMin: 45 },
  Summit: { monthlyCost: 1456, sessionsPerWeek: 4, sessionLengthMin: 60 },
  Apex: { monthlyCost: 1820, sessionsPerWeek: 5, sessionLengthMin: 60 },
};
