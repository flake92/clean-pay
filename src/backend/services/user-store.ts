export interface User {
  id: string;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
  remnashopUserId: string | null;
  fullName: string | null;
  displayName: string | null;
  photoUrl: string | null;
  authPending: boolean;
  pendingRemnashopUserId: string | null;
  pendingRemnashopEmail: string | null;
  lastLoginAt: Date | null;
}

export interface CreateUserInput {
  email?: string;
  emailVerified?: boolean;
  telegramId?: string;
  telegramUsername?: string;
  remnashopUserId?: string;
  fullName?: string;
  displayName?: string;
  photoUrl?: string;
  authPending?: boolean;
  pendingRemnashopUserId?: string;
  pendingRemnashopEmail?: string;
}

export interface UpdateUserInput {
  email?: string;
  emailVerified?: boolean;
  telegramId?: string;
  telegramUsername?: string;
  remnashopUserId?: string;
  fullName?: string;
  displayName?: string;
  photoUrl?: string;
  authPending?: boolean;
  pendingRemnashopUserId?: string;
  pendingRemnashopEmail?: string;
  lastLoginAt?: Date;
}

export interface UpsertUserWhere {
  id?: string;
  email?: string;
  telegramId?: string;
}

export interface UserWhereInput {
  id?: string;
  email?: string;
  telegramId?: string;
  remnashopUserId?: string;
  OR?: UserWhereInput[];
}

export interface UserStore {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByTelegramId(telegramId: string): Promise<User | null>;
  findByRemnashopId(remnashopUserId: string): Promise<User | null>;
  findMany(where: UserWhereInput): Promise<User[]>;
  create(data: CreateUserInput): Promise<User>;
  update(id: string, data: UpdateUserInput): Promise<User>;
  upsert(where: UpsertUserWhere, create: CreateUserInput, update: UpdateUserInput): Promise<User>;
  deleteMany(ids: string[]): Promise<number>;
}
