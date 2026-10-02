import { Link } from "@tanstack/react-router";

import { UserMenu } from "@/components/auth/UserMenu.tsx";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  CreditCard,
  BarChart3,
} from "lucide-react";

const items = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/" as const },
  { label: "Transações", icon: ArrowLeftRight, to: "/transacoes" as const },
  { label: "Categorias", icon: Tags, to: "/categorias" as const },
  { label: "Parcelamentos", icon: CreditCard, to: "/parcelamentos" as const },
  { label: "Relatórios", icon: BarChart3, to: "/relatorios" as const },
];

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 shrink-0 border-r border-border bg-background flex-col gap-12 p-8 sticky top-0 h-screen">
      <Link to="/" className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-semibold text-sm">
            F
          </span>
        </div>
        <span className="text-lg tracking-tight font-medium text-primary">
          Fisco
        </span>
      </Link>
      <nav className="flex flex-col gap-1">
        {items.map(({ label, icon: Icon, to }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/60 data-[status=active]:bg-secondary data-[status=active]:text-primary data-[status=active]:font-medium"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      {/*
        Substitui "Dados armazenados localmente", que deixou de ser verdade
        quando o banco virou Postgres gerenciado no Neon (D-Vercel-2). Texto
        desatualizado sobre onde mora dado financeiro é pior que texto nenhum.
      */}
      <UserMenu />
    </aside>
  );
}
