import { useLayoutEffect, useRef } from "react";

/**
 * Área rolável dos gráficos de meses (`docs/mobile-first.md` → M-11).
 *
 * No celular a trilha tem a largura das colunas (cada gráfico dá às suas uma
 * largura fixa), e o que não cabe rola aqui dentro, sem a página ganhar
 * transbordo horizontal — que era o que empurrava a barra inferior para fora
 * da tela. A partir de `md` a trilha ocupa a largura do card, como antes.
 *
 * É o único lugar com rolagem horizontal permitida pelo contrato (P7). A
 * região é focável e rotulada para dar para rolar pelo teclado; a barra de
 * rolagem fica visível porque é ela que avisa que há meses à esquerda.
 */
export function MonthScroller({
  label,
  count,
  children,
}: {
  label: string;
  /** Quantos meses o gráfico mostra; só uma mudança aqui volta a rolagem ao fim. */
  count: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Começa no mês mais recente, o último da API. Antes da pintura, para não
  // piscar no começo da série; refetch com o mesmo número de meses não mexe.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [count]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto overscroll-x-contain rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-end gap-4 md:gap-6 w-max md:w-full">
        {children}
      </div>
    </div>
  );
}
