/**
 * Mensagem legível a partir do corpo de erro da API.
 *
 * O FastAPI manda `detail` como texto nos erros de negócio (404, 409) e como
 * **lista** de erros no 422 do Pydantic. Passar a lista direto para
 * `new Error(...)` dava o toast "[object Object]".
 */
export function errorMessage(body: unknown, fallback: string): string {
  const detail =
    body !== null && typeof body === "object"
      ? (body as { detail?: unknown }).detail
      : undefined;

  if (typeof detail === "string" && detail.trim() !== "") return detail;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        item !== null && typeof item === "object"
          ? (item as { msg?: unknown }).msg
          : undefined,
      )
      .filter((msg): msg is string => typeof msg === "string" && msg !== "");
    if (messages.length > 0) return messages.join("; ");
  }

  return fallback;
}
