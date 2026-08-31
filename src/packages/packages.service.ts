import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as dynamoose from 'dynamoose';
import { PackagesModel } from '../models/packages.model';
import { PackageRow } from '../models/package-row.model';
import { CUSTOM_PACKAGE, PackageCatalog } from '../billing/package-config';

/** Dynamoose surfaces a failed conditional write in a few shapes. */
function isConditionalFailure(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return (
    name === 'ConditionalCheckFailedException' ||
    message.includes('ConditionalCheckFailedException') ||
    message.includes('The conditional request failed')
  );
}

@Injectable()
export class PackagesService {
  async getPackages() {
    return PackagesModel.scan()
      .all()
      .exec()
      .then((rows) => {
        return rows;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** The catalog keyed by package name — retired entries INCLUDED (they must
   *  keep resolving for students still on them). Used by the billing cron. */
  async getCatalog(): Promise<PackageCatalog> {
    const rows = (await this.getPackages()) as unknown as PackageRow[];
    const catalog: PackageCatalog = {};
    for (const row of rows) {
      catalog[row.id] = {
        monthlyCost: row.monthlyCost,
        sessionsPerWeek: row.sessionsPerWeek,
        sessionLengthMin: row.sessionLengthMin,
        retired: !!row.retired,
      };
    }
    return catalog;
  }

  /**
   * Creates a new package. The conditional create (attribute_not_exists via
   * Model.create) closes the duplicate-name race. Rows are immutable after
   * create except the retired flag — there is deliberately no update path
   * for the name or the three numbers.
   */
  async createPackage(row: PackageRow) {
    const name = this.validate(row);
    const now = new Date().toISOString();
    return PackagesModel.create({
      id: name,
      monthlyCost: row.monthlyCost,
      sessionsPerWeek: row.sessionsPerWeek,
      sessionLengthMin: row.sessionLengthMin,
      retired: false,
      created_at: now,
      updated_at: now,
    })
      .then(() => {
        return { id: name, message: 'Package created.' };
      })
      .catch((error: Error) => {
        if (isConditionalFailure(error)) {
          throw new ConflictException(
            `A package named ${name} already exists.`,
          );
        }
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** Retires a package: hidden from selects, still resolves for students on it. */
  async retirePackage(id: string) {
    return this.setRetired(id, true, 'Package retired.');
  }

  /** Un-retires a package (an accidental retire would otherwise be permanent —
   *  the name can't be recreated). */
  async restorePackage(id: string) {
    return this.setRetired(id, false, 'Package restored.');
  }

  private async setRetired(id: string, retired: boolean, message: string) {
    return PackagesModel.update(
      { id },
      { retired, updated_at: new Date().toISOString() },
      { condition: new dynamoose.Condition().attribute('id').exists() },
    )
      .then(() => {
        return { id, message };
      })
      .catch((error: Error) => {
        if (isConditionalFailure(error)) {
          throw new NotFoundException(`No package named ${id}.`);
        }
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** Create-time validation; returns the trimmed name. */
  private validate(row: PackageRow): string {
    const name = (row.id ?? '').trim();
    if (!name) {
      throw new BadRequestException('The package needs a name.');
    }
    if (name.toLowerCase() === CUSTOM_PACKAGE.toLowerCase()) {
      throw new BadRequestException(
        `'${CUSTOM_PACKAGE}' is reserved for per-student custom packages.`,
      );
    }
    for (const [label, value] of [
      ['monthly cost', row.monthlyCost],
      ['sessions per week', row.sessionsPerWeek],
      ['session length', row.sessionLengthMin],
    ] as const) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new BadRequestException(
          `The ${label} must be a positive number.`,
        );
      }
    }
    return name;
  }
}
