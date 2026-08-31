import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { User } from '../models/user.model';
import { PackageRow } from '../models/package-row.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'c-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'c-tutor',
};
const groupless: User = {
  username: 'nogroups',
  email: 'nogroups@example.com',
  groups: undefined as unknown as string[],
  contact: 'c-nogroups',
};
const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const row = {
  id: 'Zenith',
  monthlyCost: 2000,
  sessionsPerWeek: 5,
  sessionLengthMin: 60,
} as PackageRow;

describe('PackagesController', () => {
  let controller: PackagesController;
  let service: jest.Mocked<PackagesService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<PackagesService>> = {
      getPackages: jest.fn(),
      createPackage: jest.fn(),
      retirePackage: jest.fn(),
      restorePackage: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PackagesController],
      providers: [{ provide: PackagesService, useValue: serviceMock }],
    }).compile();
    controller = module.get(PackagesController);
    service = module.get(PackagesService);
  });

  it('GET is open to any authenticated user — tutors resolve packages too', async () => {
    await controller.getPackages();
    expect(service.getPackages).toHaveBeenCalled();
  });

  it('admin can create a package', async () => {
    await controller.createPackage(reqAs(admin), row);
    expect(service.createPackage).toHaveBeenCalledWith(row);
  });

  it('admin can retire and restore a package', async () => {
    await controller.retirePackage(reqAs(admin), 'Zenith');
    expect(service.retirePackage).toHaveBeenCalledWith('Zenith');
    await controller.restorePackage(reqAs(admin), 'Zenith');
    expect(service.restorePackage).toHaveBeenCalledWith('Zenith');
  });

  it('non-admins are rejected on every mutation route', async () => {
    await expect(controller.createPackage(reqAs(tutor), row)).rejects.toThrow(
      'Unauthorized',
    );
    await expect(
      controller.retirePackage(reqAs(tutor), 'Zenith'),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.restorePackage(reqAs(tutor), 'Zenith'),
    ).rejects.toThrow('Unauthorized');
    expect(service.createPackage).not.toHaveBeenCalled();
    expect(service.retirePackage).not.toHaveBeenCalled();
    expect(service.restorePackage).not.toHaveBeenCalled();
  });

  it('a user with no cognito groups is rejected, not crashed', async () => {
    await expect(
      controller.createPackage(reqAs(groupless), row),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.retirePackage(reqAs(groupless), 'Zenith'),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.restorePackage(reqAs(groupless), 'Zenith'),
    ).rejects.toThrow('Unauthorized');
  });
});
