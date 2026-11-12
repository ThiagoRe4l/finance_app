import { Link, useRouterState } from "@tanstack/react-router";

import { NAV_ICONS } from "@/components/layout/nav-icons";
import { NAV_ITEMS, activeNavKey } from "@/lib/navigation";

/**
 * Barra inferior, só abaixo de `lg` (`docs/mobile-first.md` → M-1, M-10).
 *
 * O item ativo vem de `activeNavKey`. `exact: true` no `Link` é de propósito:
 * o TanStack põe `aria-current="page"` sozinho quando o link está ativo, e no
 * modo padrão (fuzzy) o "/" ficaria ativo em todas as telas.
 */
export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = activeNavKey(pathname);

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex h-[var(--app-bottombar-height)]">
        {NAV_ITEMS.map(({ key, to, shortLabel }) => {
          const Icon = NAV_ICONS[key];
          const isActive = key === active;
          return (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: true }}
              aria-current={isActive ? "page" : undefined}
              className="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground transition-colors aria-[current=page]:font-medium aria-[current=page]:text-primary"
            >
              <Icon className="h-5 w-5" />
              {shortLabel}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
