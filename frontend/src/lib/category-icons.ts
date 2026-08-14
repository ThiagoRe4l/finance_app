/**
 * `icon_name` da API → componente do lucide.
 *
 * A API devolve a string (`"Home"`); o JSX precisa do componente. `icon_name` é
 * **string livre** no schema (`String(50)`, sem validação), então qualquer valor
 * pode chegar — e `<undefined />` derruba a árvore React inteira, não só o
 * ícone.
 *
 * Mapa explícito, não dinâmico: o lucide exporta 5799 símbolos, e listar os
 * suportados mantém o bundle previsível e visível. O custo é ter que
 * acrescentar aqui quando o backend passar a emitir um `icon_name` novo — é
 * para isso que existe o fallback, e há teste cruzando este mapa com os ícones
 * do seed.
 *
 * Único módulo de `lib/` que depende de biblioteca de UI. Fica separado de
 * `categories.ts` para o cálculo de orçamento não arrastar o lucide junto.
 */

import {
  Car,
  CircleDashed,
  CircleDollarSign,
  Gamepad2,
  GraduationCap,
  HeartPulse,
  Home,
  Laptop,
  PiggyBank,
  Plus,
  ShoppingBag,
  Sofa,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Neutro de propósito: comunica "categoria sem ícone definido", não "algo deu
 * errado". O estado é comum e esperado.
 */
export const FALLBACK_ICON: LucideIcon = CircleDashed;

const ICONS: Record<string, LucideIcon> = {
  // Os `icon_name` que o seed do backend produz (`app/init_db.py`).
  Car,
  Gamepad2,
  GraduationCap,
  HeartPulse,
  Home,
  Laptop,
  Plus,
  ShoppingBag,
  Sofa,
  UtensilsCrossed,

  // Vocabulário de dinheiro (13/08/2026). A categoria `Receita` do seed usava
  // `Plus` — traço fino — com `color: "oklch(0.94 …)"`, quase branco, que pinta
  // o ícone e o fundo da caixinha: ilegível. As quatro entram juntas porque
  // devem reaparecer em categorias novas de receita/poupança.
  CircleDollarSign,
  PiggyBank,
  TrendingUp,
  Wallet,
};

/**
 * Nomes suportados, para o seletor do formulário e para o schema.
 *
 * Deriva do próprio mapa: acrescentar um ícone acima o torna selecionável e
 * válido sem tocar em mais nada.
 */
export const CATEGORY_ICON_NAMES = Object.keys(ICONS);

export function isKnownCategoryIcon(iconName: string): boolean {
  return typeof iconName === "string" && iconName in ICONS;
}

export function resolveCategoryIcon(iconName: string): LucideIcon {
  if (typeof iconName !== "string" || iconName === "") {
    return FALLBACK_ICON;
  }
  return ICONS[iconName] ?? FALLBACK_ICON;
}
