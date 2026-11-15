import type { StateCreator } from "zustand";
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

export const useBoundStore = create<BoundState>()((...args) => ({
  ...createUserSlice(...args),
}));
