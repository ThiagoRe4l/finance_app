import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  CreditCard,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

import type { NavKey } from "@/lib/navigation";

/** Ícone de cada item da navegação — os mesmos da Sidebar de antes da 1c. */
export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  inicio: LayoutDashboard,
  transacoes: ArrowLeftRight,
  categorias: Tags,
  parcelamentos: CreditCard,
  relatorios: BarChart3,
};
