/**
 * Cabeçalho único dos cartões do Dashboard (`docs/tema.md`, D-Tema-8): o título
 * em Fraunces desde o Caderno (D-Cad-6) e, embaixo, a linha de apoio em 13 px.
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
      <h2 className="font-display text-xl font-medium">{title}</h2>
      {subtitle && (
        <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
