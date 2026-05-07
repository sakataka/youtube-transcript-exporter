type BackendCommandArgs = Record<string, unknown>;

export async function invokeBackend<T = unknown>(
  command: string,
  args: BackendCommandArgs = {}
): Promise<T> {
  const response = await fetch(`/api/${command}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractBackendError(payload) || `API request failed: ${response.status}`);
  }

  return payload as T;
}

function extractBackendError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    return typeof error === "string" ? error : "";
  }

  return "";
}
