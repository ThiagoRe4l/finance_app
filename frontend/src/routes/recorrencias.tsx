import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InstallmentsPanel } from "@/components/installments/InstallmentsPanel";
import { SubscriptionsPanel } from "@/components/subscriptions/SubscriptionsPanel";

type Aba = "assinaturas" | "parcelamentos";

export const Route = createFileRoute("/recorrencias")({
  // A aba vai na URL: o redirect de `/parcelamentos` e o "voltar" do navegador
  // dependem disso. Opcional, para os `Link` da navegação não precisarem dela.
  validateSearch: (search: Record<string, unknown>): { aba?: Aba } =>
    search.aba === "parcelamentos"
      ? { aba: "parcelamentos" }
      : search.aba === "assinaturas"
        ? { aba: "assinaturas" }
        : {},
  head: () => ({
    meta: [
      { title: "Recorrências — Fisco" },
      {
        name: "description",
        content:
          "Assinaturas que cobram todo mês e parcelas em aberto, num só lugar.",
      },
    ],
  }),
  component: RecorrenciasPage,
});

function RecorrenciasPage() {
  const { aba = "assinaturas" } = Route.useSearch();
  const navigate = Route.useNavigate();
  // O botão de criar mora no cabeçalho (F-1); cada painel só renderiza o diálogo.
  const [creating, setCreating] = useState(false);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Mês corrente"
        title="Recorrências"
        description="Assinaturas que cobram todo mês e parcelas em aberto."
      />

      <Tabs
        value={aba}
        onValueChange={(value) =>
          navigate({ search: { aba: value as Aba }, replace: true })
        }
      >
        {/* Opção B (F-2): abas em sublinhado e, no fim da mesma linha, a ação. */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-border">
          <TabsList className="h-auto justify-start gap-6 rounded-none bg-transparent p-0">
            <TabsTrigger
              value="assinaturas"
              className="-mb-px h-11 sm:h-9 rounded-none border-b-2 border-transparent bg-transparent px-1 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Assinaturas
            </TabsTrigger>
            <TabsTrigger
              value="parcelamentos"
              className="-mb-px h-11 sm:h-9 rounded-none border-b-2 border-transparent bg-transparent px-1 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Parcelamentos
            </TabsTrigger>
          </TabsList>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mb-2 flex items-center justify-center gap-2 px-4 py-2 min-h-11 lg:min-h-0 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" />{" "}
            {aba === "assinaturas" ? "Nova assinatura" : "Novo parcelamento"}
          </button>
        </div>
        <TabsContent value="assinaturas" className="mt-0">
          <SubscriptionsPanel
            isCreating={creating}
            onCreatingChange={setCreating}
          />
        </TabsContent>
        <TabsContent value="parcelamentos" className="mt-0">
          <InstallmentsPanel
            isCreating={creating}
            onCreatingChange={setCreating}
          />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
