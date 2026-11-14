type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: HttpMethod,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path.replace(/^\/+/, "")}`, {
    method,
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
  });
  const responseText = await response.text();
  let payload: unknown;

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : typeof payload === "string" && payload
          ? payload
          : `Request failed with status ${response.status}`;

    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, data: unknown) =>
  request<T>("POST", path, data);
export const put = <T>(path: string, data: unknown) =>
  request<T>("PUT", path, data);
export const del = <T>(path: string, data?: unknown) =>
  request<T>("DELETE", path, data);
