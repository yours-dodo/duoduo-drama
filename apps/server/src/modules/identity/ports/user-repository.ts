export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface IdentityUserSnapshot {
  id: string;
  email: string;
  createdAt: Date;
}

export interface FindOrCreateUserRequest {
  email: string;
  newUserId: string;
}

export interface UserRepository {
  findOrCreateByEmail(
    request: FindOrCreateUserRequest,
  ): Promise<IdentityUserSnapshot>;
}
