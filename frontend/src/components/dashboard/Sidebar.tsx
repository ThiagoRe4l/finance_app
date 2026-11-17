import { Link } from "@tanstack/react-router";

import { UserMenu } from "@/components/auth/UserMenu.tsx";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { NAV_ITEMS } from "@/lib/navigation";

export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col gap-12 p-8 sticky top-0 h-dvh">
      <Link to="/" className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
          <span className="text-sidebar-primary-foreground font-display font-semibold text-sm">
            F
          </span>
        </div>
        <span className="text-lg tracking-tight font-display font-semibold text-sidebar-foreground">
          Fisco
        </span>
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ key, label, to }) => {
          const Icon = NAV_ICONS[key];
          return (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: true }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent data-[status=active]:bg-sidebar-primary data-[status=active]:text-sidebar-primary-foreground data-[status=active]:font-medium"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
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
