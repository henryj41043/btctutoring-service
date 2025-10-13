import { Injectable } from '@nestjs/common';
import { User, UserModel } from './user.schema';
import * as bcrypt from 'bcrypt';
import { AnyItem } from 'dynamoose/dist/Item';

@Injectable()
export class UsersService {
  private saltRounds: number = 10;

  async createUser(userData: User): Promise<any> {
    userData.Password = await this.hashPassword(userData.Password);
    const user = new UserModel(userData);
    return user.save();
  }

  async getUserById(UserId: string): Promise<any> {
    return UserModel.get(UserId);
  }

  async login(userData: User): Promise<any> {
    const userItem: AnyItem = await UserModel.get(userData.Password);
    const user: User = <User>userItem.toJSON();
    return await this.verifyPassword(userData.Password, user.Password);
  }

  private async hashPassword(password: string): Promise<string> {
    const salt: string = await bcrypt.genSalt(this.saltRounds);
    return await bcrypt.hash(password, salt);
  }

  private async verifyPassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }
}
