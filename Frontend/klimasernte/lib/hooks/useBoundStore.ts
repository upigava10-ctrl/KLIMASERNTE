import type { StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import { create } from "zustand";
import { createUserSlice } from "@/lib/store/createUserStore";
import type { UserSlice } from "../slices/userSlice";

type BoundState = UserSlice;

export type BoundStateCreator<SliceState> = StateCreator<
  BoundState,
  [],
  [],
  SliceState
>;

export const useBoundStore = create<BoundState>()(
  persist(
    (...args) => ({
      ...createUserSlice(...args),
    }),
    {
      name: "bound-storage",
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
