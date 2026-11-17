import { useId } from "react";

/**
 * A marca do Fisco: o mesmo desenho do ícone da aba (`public/favicon.svg`),
 * com o SVG inline para não depender de arquivo servido de `public/`. Se o
 * favicon mudar, este desenho muda junto.
 *
 * Decorativa: o nome "Fisco" vem sempre ao lado. O id do gradiente sai do
 * `useId` porque a Sidebar e a TopBar podem estar no DOM ao mesmo tempo (uma
 * escondida por CSS), e um id fixo repetido faria uma usar o gradiente da outra.
 */
export function BrandMark({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#26404f" />
          <stop offset="1" stopColor="#14222b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gradient})`} />
      <path
        d="M22 47V17h20"
        fill="none"
        stroke="#faf8f5"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 31h14"
        fill="none"
        stroke="#63d18f"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}
