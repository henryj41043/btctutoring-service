import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { DocumentsService, UploadLink } from './documents.service';
import { User } from '../models/user.model';
import { ContactDocument } from '../models/contact-document.model';
import { UploadRequestDto } from './dto/upload-request.dto';

/** Admin-only throughout: documents are personal files (resumes, forms). */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  private adminOf(req: express.Request, action: string): User {
    const user: User = req.user as User;
    if (!(user.groups ?? []).includes('Admins')) {
      Logger.error(`User not authorized to ${action}`);
      throw new ForbiddenException('Unauthorized');
    }
    return user;
  }

  @Get('contact/:contactId')
  @UseGuards(AuthGuard('jwt'))
  async getDocumentsByContact(
    @Request() req: express.Request,
    @Param('contactId') contactId: string,
  ): Promise<ContactDocument[]> {
    this.adminOf(req, 'list contact documents');
    return this.documentsService.getDocumentsByContact(contactId);
  }

  @Post('contact/:contactId/upload-url')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'))
  async createUploadLink(
    @Request() req: express.Request,
    @Param('contactId') contactId: string,
    @Body() body: UploadRequestDto,
  ): Promise<UploadLink> {
    const user = this.adminOf(req, 'upload a document');
    return this.documentsService.createUploadLink(
      contactId,
      body,
      user.username,
    );
  }

  @Post(':id/complete')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'))
  async completeUpload(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<ContactDocument> {
    this.adminOf(req, 'complete an upload');
    return this.documentsService.completeUpload(id);
  }

  @Get(':id/url')
  @UseGuards(AuthGuard('jwt'))
  async getDocumentUrl(
    @Request() req: express.Request,
    @Param('id') id: string,
    @Query('mode') mode?: string,
  ): Promise<{ url: string }> {
    this.adminOf(req, 'open a document');
    return this.documentsService.getDocumentUrl(
      id,
      mode === 'view' ? 'view' : 'download',
    );
  }

  @Delete('contact/:contactId')
  @UseGuards(AuthGuard('jwt'))
  async deleteDocumentsByContact(
    @Request() req: express.Request,
    @Param('contactId') contactId: string,
  ): Promise<{ deleted: number }> {
    this.adminOf(req, 'delete contact documents');
    return this.documentsService.deleteDocumentsByContact(contactId);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteDocument(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<{ id: string; message: string }> {
    this.adminOf(req, 'delete a document');
    return this.documentsService.deleteDocument(id);
  }
}
