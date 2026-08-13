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
  Gamepad2,
  GraduationCap,
  HeartPulse,
  Home,
  Laptop,
  Plus,
  ShoppingBag,
  Sofa,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * Neutro de propósito: comunica "categoria sem ícone definido", não "algo deu
 * errado". O estado é comum e esperado.
 */
export const FALLBACK_ICON: LucideIcon = CircleDashed;

/** Os `icon_name` que o seed do backend produz (`app/init_db.py`). */
const ICONS: Record<string, LucideIcon> = {
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
};

export function resolveCategoryIcon(iconName: string): LucideIcon {
  if (typeof iconName !== "string" || iconName === "") {
    return FALLBACK_ICON;
  }
  return ICONS[iconName] ?? FALLBACK_ICON;
}
