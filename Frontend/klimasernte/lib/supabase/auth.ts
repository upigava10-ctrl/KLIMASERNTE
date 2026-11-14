import type { User } from "@/lib/models/user";
import { createClient } from "@/lib/supabase/client";

const farmerProducerSizes = new Set(["small", "medium", "big"]);

function isUserProfile(value: unknown): value is User {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const profile = value as Record<string, unknown>;

  return (
    typeof profile.uuid === "string" &&
    typeof profile.nombre === "string" &&
    (typeof profile.producerSize === "string" || profile.producerSize === null) &&
    typeof profile.email === "string" &&
    typeof profile.isFarmer === "boolean" &&
    typeof profile.created_at === "string" &&
    typeof profile.updated_at === "string" &&
    typeof profile.apellido_p === "string" &&
    typeof profile.apellido_m === "string" &&
    typeof profile.active_u === "boolean"
  );
}

async function clearSessionAndThrow(message: string): Promise<never> {
  const { error } = await createClient().auth.signOut();
  if (error) {
    throw new Error(`${message} Also failed to clear the session: ${error.message}`);
  }

  throw new Error(message);
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("*")
    .eq("uuid", data.user.id)
    .maybeSingle();

  if (profileError) {
    return clearSessionAndThrow(
      `Could not load your user profile: ${profileError.message}`,
    );
  }

  if (!profile) {
    return clearSessionAndThrow(
      "No registered user profile was found for this account.",
    );
  }

  if (!isUserProfile(profile)) {
    return clearSessionAndThrow(
      "The registered user profile does not match the expected user fields.",
    );
  }

  return {
    ...profile,
    isFarmer:
      profile.producerSize !== null &&
      farmerProducerSizes.has(profile.producerSize.toLowerCase()),
  };
}
