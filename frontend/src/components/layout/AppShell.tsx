import { Sidebar } from "@/components/dashboard/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { TopBar } from "@/components/layout/TopBar";

/**
 * Layout externo das 5 telas (`docs/mobile-first.md` → M-9, M-10).
 *
 * Abaixo de `lg`: barra superior e inferior fixas; o main reserva o espaço
 * delas (altura + área segura + o padding de antes). A partir de `lg` as barras
 * somem, a Sidebar aparece e `lg:pt-12 lg:pb-12` devolvem o `md:p-12` de antes.
 * `min-w-0` só confina o overflow; as causas ficam nas fatias 3–5 (M-9).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <TopBar />
      <BottomNav />
      <Sidebar />
      <main className="flex-1 min-w-0 p-6 md:p-12 pt-[calc(var(--app-topbar-height)+env(safe-area-inset-top)+1.5rem)] pb-[calc(var(--app-bottombar-height)+env(safe-area-inset-bottom)+1.5rem)] md:pt-[calc(var(--app-topbar-height)+env(safe-area-inset-top)+3rem)] md:pb-[calc(var(--app-bottombar-height)+env(safe-area-inset-bottom)+3rem)] lg:pt-12 lg:pb-12 max-w-[1400px] mx-auto">
        {children}
      </main>
    </div>
  );
}
