import type { User } from "@/lib/models/user";

type UserApiResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
};

export type CreateUserInput = {
  nombre: string;
  apellido_p: string;
  apellido_m: string;
  email: string;
  producerSize: "small" | "medium" | "big";
  photourl?: string;
};

async function readResponse(response: Response): Promise<UserApiResponse> {
  const result = (await response.json()) as UserApiResponse;
  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.error ?? `Request failed with status ${response.status}`);
  }
  return result;
}

function normalizeUser(value: unknown): User {
  if (typeof value !== "object" || value === null) {
    throw new Error("The user API returned an invalid profile.");
  }

  const row = value as Record<string, unknown>;
  const producerSize =
    typeof row.producersize === "string" ? row.producersize : null;
  const farmerSizes = new Set(["small", "medium", "big"]);

  if (
    typeof row.id !== "number" ||
    typeof row.uuid !== "string" ||
    typeof row.nombre !== "string" ||
    typeof row.email !== "string" ||
    typeof row.apellido_p !== "string" ||
    typeof row.apellido_m !== "string"
  ) {
    throw new Error("The user API returned a profile with missing fields.");
  }

  return {
    id: row.id,
    uuid: row.uuid,
    nombre: row.nombre,
    producerSize,
    email: row.email,
    isFarmer:
      producerSize !== null && farmerSizes.has(producerSize.toLowerCase()),
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    apellido_p: row.apellido_p,
    apellido_m: row.apellido_m,
    active_u: row.activate_u === true,
    photourl: typeof row.photourl === "string" ? row.photourl : null,
  };
}

export async function getUserByEmail(email: string): Promise<User> {
  const query = new URLSearchParams({ email: email.trim() });
  const response = await fetch(
    `/api/supabase/user/getUser?${query.toString()}`,
  );
  const result = await readResponse(response);
  return normalizeUser(result.data);
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const response = await fetch("/api/supabase/user/createUser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await readResponse(response);
  return normalizeUser(result.data);
}
