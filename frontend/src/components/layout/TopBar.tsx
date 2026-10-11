import { Link } from "@tanstack/react-router";

import { UserMenu } from "@/components/auth/UserMenu.tsx";

/**
 * Barra superior fina, só abaixo de `lg`: marca e conta/logout
 * (`docs/mobile-first.md` → M-1, M-10). A partir de `lg` isso mora na Sidebar.
 */
export function TopBar() {
  return (
    <header className="fixed top-0 inset-x-0 z-40 lg:hidden border-b border-border bg-background pt-[env(safe-area-inset-top)]">
      <div className="flex h-[var(--app-topbar-height)] items-center justify-between gap-4 px-4">
        <Link to="/" className="flex min-h-11 shrink-0 items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-semibold text-xs">
              F
            </span>
          </div>
          <span className="tracking-tight font-medium text-primary">Fisco</span>
        </Link>
        <UserMenu variant="topbar" />
      </div>
    </header>
  );
}
