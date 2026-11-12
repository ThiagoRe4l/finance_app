/**
 * Fonte única da navegação (`docs/mobile-first.md` → M-1, M-10): a Sidebar
 * (a partir de `lg`) e a barra inferior (abaixo de `lg`) leem daqui.
 *
 * Sem ícone de propósito: ícone é componente React, e isto é função pura. O
 * mapa chave → ícone fica em `components/layout/nav-icons.ts`.
 */

export type NavKey =
  "inicio" | "transacoes" | "categorias" | "parcelamentos" | "relatorios";

export type NavItem = {
  key: NavKey;
  to: "/" | "/transacoes" | "/categorias" | "/parcelamentos" | "/relatorios";
  /** Rótulo da Sidebar — o de antes da 1c, para ≥ 1024 px não mudar. */
  label: string;
  /** Rótulo da barra inferior: até 10 caracteres, cabe em ~64 px. */
  shortLabel: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "inicio", to: "/", label: "Dashboard", shortLabel: "Início" },
  {
    key: "transacoes",
    to: "/transacoes",
    label: "Transações",
    shortLabel: "Transações",
  },
  {
    key: "categorias",
    to: "/categorias",
    label: "Categorias",
    shortLabel: "Categorias",
  },
  {
    key: "parcelamentos",
    to: "/parcelamentos",
    label: "Parcelamentos",
    shortLabel: "Parcelas",
  },
  {
    key: "relatorios",
    to: "/relatorios",
    label: "Relatórios",
    shortLabel: "Relatórios",
  },
];

/**
 * O item ativo para um `pathname`. `/` só casa com `/`; os outros casam com o
 * caminho exato ou um subcaminho (`/transacoes/…`). Barra final é ignorada.
 */
export function activeNavKey(pathname: string): NavKey | null {
  const path =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  for (const { key, to } of NAV_ITEMS) {
    if (to === "/") {
      if (path === "/") return key;
    } else if (path === to || path.startsWith(`${to}/`)) {
      return key;
    }
  }
  return null;
}
