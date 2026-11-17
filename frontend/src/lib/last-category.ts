/**
 * Categoria padrão = a última usada (`docs/ux-leis.md`, M3). Só conveniência
 * por navegador: o armazenamento pode faltar ou lançar, e a tela funciona igual.
 */

export const LAST_CATEGORY_KEY = "finance.lastCategoryId";

type Store = Pick<Storage, "getItem" | "setItem">;

export function rememberLastCategory(
  storage: Store | undefined,
  id: number,
): void {
  try {
    storage?.setItem(LAST_CATEGORY_KEY, String(id));
  } catch {
    // Sem armazenamento: o padrão simplesmente não é lembrado.
  }
}

/** O id (texto do Select) se ainda existir entre `validIds`; senão `""`. */
export function readLastCategory(
  storage: Store | undefined,
  validIds: readonly number[],
): string {
  try {
    const raw = storage?.getItem(LAST_CATEGORY_KEY);
    if (raw == null || !/^\d+$/.test(raw)) return "";
    return validIds.includes(Number(raw)) ? raw : "";
  } catch {
    return "";
  }
}

/** Mais usadas primeiro, empate por nome. Devolve cópia. */
export function orderCategories<T extends { name: string; txs_count: number }>(
  categories: readonly T[],
): T[] {
  return [...categories].sort(
    (a, b) =>
      b.txs_count - a.txs_count || a.name.localeCompare(b.name, "pt-BR"),
  );
}
