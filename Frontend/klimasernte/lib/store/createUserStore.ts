import type { BoundStateCreator } from "@/lib/hooks/useBoundStore";
import type { UserSlice } from "../slices/userSlice";

export const createUserSlice: BoundStateCreator<UserSlice> = (set) => ({
  user: null,
  authStatus: "unidentified",
  setUser: (user) => set({ user }),
  setAuthStatus: (authStatus) => set({ authStatus }),
});
