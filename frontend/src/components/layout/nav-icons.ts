import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  Repeat,
  type LucideIcon,
} from "lucide-react";

import type { NavKey } from "@/lib/navigation";

/** Ícone de cada item da navegação — os mesmos da Sidebar de antes da 1c. */
export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  inicio: LayoutDashboard,
  transacoes: ArrowLeftRight,
  categorias: Tags,
  recorrencias: Repeat,
};
