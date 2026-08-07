export type UserWhereInput = {
  id?: string;
  email?: string;
  telegramId?: string;
  remnashopUserId?: string;
  OR?: UserWhereInput[];
};

export type CreateUserInput = {
  email?: string | null;
  emailVerified?: boolean;
  telegramId?: string | null;
  telegramUsername?: string | null;
  remnashopUserId?: string | null;
  fullName?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  authPending?: boolean;
  pendingRemnashopUserId?: string | null;
  pendingRemnashopEmail?: string | null;
};

export type UpdateUserInput = Partial<CreateUserInput> & {
  lastLoginAt?: Date;
};

export type UpsertUserWhere = {
  telegramId?: string;
  email?: string;
};

export type MergeOptions = {
  reason: string;
  dryRun?: boolean;
  emailResolution?: "REJECT" | "KEEP_TARGET";
  telegramResolution?: "REJECT" | "KEEP_SOURCE";
  paymentResolution?: "REJECT" | "REKEY_SOURCE";
};

export type User = {
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
};

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
