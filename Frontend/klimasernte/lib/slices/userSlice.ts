import type { User } from "../models/user";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type UserSlice = {
  user: User | null;
  authStatus: AuthStatus;
  setUser: (user: User | null) => void;
  setAuthStatus: (status: AuthStatus) => void;
};
