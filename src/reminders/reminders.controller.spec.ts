import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { User } from '../models/user.model';
import { Reminder } from '../models/reminder.model';

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

const reminder = { id: 'rem-1', title: 'Call John' } as Reminder;

describe('RemindersController', () => {
  let controller: RemindersController;
  let service: jest.Mocked<RemindersService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<RemindersService>> = {
      getReminders: jest.fn(),
      createReminder: jest.fn(),
      updateReminder: jest.fn(),
      deleteReminder: jest.fn(),
      completeReminder: jest.fn(),
      uncompleteReminder: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RemindersController],
      providers: [{ provide: RemindersService, useValue: serviceMock }],
    }).compile();
    controller = module.get(RemindersController);
    service = module.get(RemindersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('admin can list reminders', async () => {
    await controller.getReminders(reqAs(admin));
    expect(service.getReminders).toHaveBeenCalled();
  });

  it('admin can create a reminder', async () => {
    await controller.createReminder(reqAs(admin), reminder);
    expect(service.createReminder).toHaveBeenCalledWith(reminder);
  });

  it('admin can update a reminder', async () => {
    await controller.updateReminder(reqAs(admin), reminder);
    expect(service.updateReminder).toHaveBeenCalledWith(reminder);
  });

  it('admin can delete a reminder', async () => {
    await controller.deleteReminder(reqAs(admin), 'rem-1');
    expect(service.deleteReminder).toHaveBeenCalledWith('rem-1');
  });

  it('admin can complete and reopen a reminder', async () => {
    await controller.completeReminder(reqAs(admin), 'rem-1');
    expect(service.completeReminder).toHaveBeenCalledWith('rem-1');
    await controller.uncompleteReminder(reqAs(admin), 'rem-1');
    expect(service.uncompleteReminder).toHaveBeenCalledWith('rem-1');
  });

  it('non-admin cannot complete or reopen', async () => {
    await expect(
      controller.completeReminder(reqAs(tutor), 'rem-1'),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.uncompleteReminder(reqAs(tutor), 'rem-1'),
    ).rejects.toThrow('Unauthorized');
    expect(service.completeReminder).not.toHaveBeenCalled();
    expect(service.uncompleteReminder).not.toHaveBeenCalled();
  });

  it('non-admin is rejected on every route', async () => {
    await expect(controller.getReminders(reqAs(tutor))).rejects.toThrow(
      'Unauthorized',
    );
    await expect(
      controller.createReminder(reqAs(tutor), reminder),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.updateReminder(reqAs(tutor), reminder),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.deleteReminder(reqAs(tutor), 'rem-1'),
    ).rejects.toThrow('Unauthorized');
    expect(service.getReminders).not.toHaveBeenCalled();
    expect(service.createReminder).not.toHaveBeenCalled();
    expect(service.updateReminder).not.toHaveBeenCalled();
    expect(service.deleteReminder).not.toHaveBeenCalled();
  });

  it('a user with no cognito groups is rejected everywhere, not crashed', async () => {
    await expect(controller.getReminders(reqAs(groupless))).rejects.toThrow(
      'Unauthorized',
    );
    await expect(
      controller.createReminder(reqAs(groupless), reminder),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.updateReminder(reqAs(groupless), reminder),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.deleteReminder(reqAs(groupless), 'rem-1'),
    ).rejects.toThrow('Unauthorized');
  });
});
