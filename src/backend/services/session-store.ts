export interface SessionStore {
  findById(id: string): Promise<any>;
  findByIdWithUser(id: string): Promise<any>;
  findByRefreshToken(hash: string): Promise<any>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<void>;
  updateMany(where: any, data: any): Promise<number>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void>;
}
