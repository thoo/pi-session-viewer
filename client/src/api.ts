export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  return data as T;
}

export async function fetchText(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}
