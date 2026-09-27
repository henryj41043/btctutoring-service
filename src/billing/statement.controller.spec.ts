import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { StatementController } from './statement.controller';
import { StatementService } from './statement.service';
import { User } from '../models/user.model';
import { Student } from '../models/student.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'contact-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'contact-tutor',
};
const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

describe('StatementController', () => {
  let controller: StatementController;
  const statements = {
    getStatements: jest.fn(),
    previewStatement: jest.fn(),
  };
  const preview = {
    month: '2026-09',
    student: { contact_id: 'c-1' } as Student,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatementController],
      providers: [{ provide: StatementService, useValue: statements }],
    }).compile();
    controller = module.get(StatementController);
    statements.getStatements.mockResolvedValue([{ contact_id: 'c-1' }]);
    statements.previewStatement.mockResolvedValue({ contact_id: 'c-1' });
  });

  it('admin reads a month', async () => {
    const res = await controller.getStatements(reqAs(admin), '2026-09');
    expect(statements.getStatements).toHaveBeenCalledWith('2026-09');
    expect(res).toEqual([{ contact_id: 'c-1' }]);
  });

  it('admin previews an unsaved change', async () => {
    const res = await controller.preview(reqAs(admin), preview);
    expect(statements.previewStatement).toHaveBeenCalledWith(preview);
    expect(res).toEqual({ statement: { contact_id: 'c-1' } });
  });

  it('wraps a null preview', async () => {
    statements.previewStatement.mockResolvedValue(null);
    expect(await controller.preview(reqAs(admin), preview)).toEqual({
      statement: null,
    });
  });

  it('non-admins are unauthorized', async () => {
    await expect(
      controller.getStatements(reqAs(tutor), '2026-09'),
    ).rejects.toThrow('Unauthorized');
    await expect(controller.preview(reqAs(tutor), preview)).rejects.toThrow(
      'Unauthorized',
    );
    await expect(
      controller.getStatements(
        reqAs({ ...tutor, groups: undefined as unknown as string[] }),
        '2026-09',
      ),
    ).rejects.toThrow('Unauthorized');
    expect(statements.getStatements).not.toHaveBeenCalled();
    expect(statements.previewStatement).not.toHaveBeenCalled();
  });
});
