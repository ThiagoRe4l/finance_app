/**
 * O pontilhado de livro-caixa entre o nome e o valor (Caderno, `docs/tema.md`,
 * D-Cad-6). Só decoração: `aria-hidden`, o leitor de tela lê nome e valor.
 *
 * Fica na linha de base do texto (`-translate-y-1` compensa o `items-baseline`
 * do pai) e encolhe até 1rem antes de empurrar o valor.
 */
export function Leader() {
  return (
    <span
      aria-hidden="true"
      className="min-w-4 flex-1 -translate-y-1 border-b border-dotted border-muted-foreground/40"
    />
  );
}
