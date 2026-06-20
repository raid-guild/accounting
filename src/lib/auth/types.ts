export type AuthRole = "admin" | "cleric" | "member";
export type AuthViewMode = AuthRole;

export type AuthPermissions = {
  canAccess: boolean;
  canAdmin: boolean;
  canWriteRaidAccounting: boolean;
  roles: AuthRole[];
};

export type AuthSessionData = {
  address?: `0x${string}`;
  authenticatedAt?: string;
  chainId?: number;
  nonce?: string;
  permissions?: AuthPermissions;
  viewMode?: AuthViewMode;
};
