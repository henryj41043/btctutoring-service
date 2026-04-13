import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotesService } from './notes.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Note } from '../models/note.model';

@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getNotes(
    @Request() req: express.Request,
    @Query('id') id: string,
    @Query('author') authorId: string,
    @Query('recipient') recipientId: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      if (id) {
        return this.notesService.getNote(id);
      } else if (authorId) {
        return this.notesService.getNotesByAuthor(authorId);
      } else if (recipientId) {
        return this.notesService.getNotesByRecipient(recipientId);
      } else {
        return this.notesService.getNotes();
      }
    } else {
      Logger.error('User not authorized to get notes');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createNote(@Request() req: express.Request, @Body() note: Note) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.notesService.createNote(note);
    } else {
      Logger.error('User not authorized to create notes');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateNote(@Request() req: express.Request, @Body() note: Note) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.notesService.updateNote(note);
    } else {
      Logger.error('User not authorized to update notes');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteNote(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.notesService.deleteNote(id);
    } else {
      Logger.error('User not authorized to delete notes');
      return Promise.reject(new Error('Unauthorized'));
    }
  }
}
