/**
 * Cabeçalho único dos cartões do Dashboard (`docs/tema.md`, D-Tema-8): título
 * em 15 px semibold e, embaixo, a linha de apoio em 13 px — o que a proposta de
 * design desenha em todo cartão.
 */
export function PanelTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {subtitle && (
        <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
