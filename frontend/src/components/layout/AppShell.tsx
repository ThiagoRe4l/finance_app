import { Sidebar } from "@/components/dashboard/Sidebar";

/**
 * Layout externo das 5 telas (`docs/mobile-first.md` → M-9). Extraído na
 * fatia 1b com as mesmas classes que cada rota repetia — sem mudança visual.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        {children}
      </main>
    </div>
  );
}
