import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A tela de Parcelamentos virou a aba de Parcelamentos de `/recorrencias`
 * (`docs/recorrencias.md`). A rota antiga continua existindo só para o link
 * salvo e o histórico do navegador não darem 404.
 */
export const Route = createFileRoute("/parcelamentos")({
  beforeLoad: () => {
    throw redirect({ to: "/recorrencias", search: { aba: "parcelamentos" } });
  },
});
