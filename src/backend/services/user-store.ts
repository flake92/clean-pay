export interface UserStore {
  findById(id: string): Promise<any>;
  findByEmail(email: string): Promise<any>;
  findByTelegramId(telegramId: string): Promise<any>;
  findByRemnashopId(remnashopUserId: string): Promise<any>;
  findMany(where: any): Promise<any[]>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  upsert(where: any, create: any, update: any): Promise<any>;
  deleteMany(ids: string[]): Promise<number>;
}
