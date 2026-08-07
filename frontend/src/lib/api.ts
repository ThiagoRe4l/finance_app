const API_BASE_URL = "http://localhost:8000/api";

export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(errorData.detail || response.statusText);
  }

  // Os DELETE do backend respondem 204 sem corpo. Chamar .json() num corpo
  // vazio rejeita a promise — ou seja, a exclusão dava certo e o cliente
  // enxergava erro. Ver "Operações de escrita" no CLAUDE.md.
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string) => apiFetch<T>(endpoint, { method: "GET" }),
  post: <T>(endpoint: string, data: any) =>
    apiFetch<T>(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  // Só PATCH: toda edição de tela é parcial e cada verbo custa um método aqui.
  patch: <T>(endpoint: string, data: any) =>
    apiFetch<T>(endpoint, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (endpoint: string) => apiFetch<void>(endpoint, { method: "DELETE" }),
};
