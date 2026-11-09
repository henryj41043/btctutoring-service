import { Module } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';

@Module({
  imports: [TeamsModule],
  controllers: [FamilyController],
  providers: [FamilyService],
})
export class FamilyModule {}
