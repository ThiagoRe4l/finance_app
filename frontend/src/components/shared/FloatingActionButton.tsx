import { Plus } from "lucide-react";

/**
 * Botão flutuante da ação principal, só abaixo de `lg` (`docs/mobile-first.md`
 * → M-2, M-12). Fica no nível das barras (`z-40`, M-10b), à direita e acima da
 * barra inferior; o overlay dos diálogos (`z-50`) o cobre. Quem o usa dá folga
 * embaixo da lista, para ele não cobrir o último item.
 */
export function FloatingActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="fixed right-[calc(env(safe-area-inset-right)+1rem)] bottom-[calc(var(--app-bottombar-height)+env(safe-area-inset-bottom)+1rem)] z-40 lg:hidden flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
