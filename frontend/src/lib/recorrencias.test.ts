/**
 * A tela de Recorrências — `docs/recorrencias.md` e `docs/mobile-first.md`.
 *
 * Escrito **antes** da implementação (13/11/2026). Teste sobre arquivo, como as
 * fatias da reforma mobile: prova strings e estrutura, não a renderização; a
 * conferência visual é do usuário. A varredura P1–P7 de `mobile-contract.test.ts`
 * já cobre os arquivos novos por conta própria.
 *
 * Hoje fica vermelho: nada disto existe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS } from "./navigation.ts";
import { SUBSCRIPTION_QUERY_KEYS } from "../components/subscriptions/query-keys.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");

// ---------------------------------------------------------------------------
// Navegação: Parcelamentos vira Recorrências, e a barra continua com 5 itens
// ---------------------------------------------------------------------------

test("a navegação troca Parcelamentos por Recorrências, na mesma posição", () => {
  assert.equal(NAV_ITEMS.length, 4);
  assert.deepEqual(
    NAV_ITEMS.map((i) => i.key),
    ["inicio", "transacoes", "categorias", "recorrencias"],
  );
  const item = NAV_ITEMS[3];
  assert.equal(item.to, "/recorrencias");
  assert.equal(item.label, "Recorrências");
  assert.ok(
    item.shortLabel.length <= 10,
    "o rótulo curto tem que caber na barra",
  );
});

test("o ícone de Recorrências existe no mapa da navegação", () => {
  const icons = read("../components/layout/nav-icons.ts");
  assert.match(icons, /recorrencias:\s*Repeat/);
  assert.doesNotMatch(icons, /parcelamentos:/);
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

test("/recorrencias: AppShell, cabeçalho, abas e a aba na URL", () => {
  assert.ok(existsSync(path("../routes/recorrencias.tsx")), "sem a rota");
  const src = read("../routes/recorrencias.tsx");
  assert.match(src, /createFileRoute\("\/recorrencias"\)/);
  assert.match(src, /validateSearch/);
  assert.match(src, /<AppShell>/);
  assert.match(src, /<PageHeader/);
  assert.match(src, /title="Recorrências"/);
  assert.match(src, /<Tabs\b/);
  assert.match(src, /<InstallmentsPanel\b/);
  assert.match(src, /<SubscriptionsPanel\b/);
});

test("as abas têm alvo de 44 px no toque (M-7, P4)", () => {
  const src = read("../routes/recorrencias.tsx");
  const triggers = [...src.matchAll(/<TabsTrigger\b[^>]*className="([^"]*)"/g)];
  assert.equal(triggers.length, 2, "uma aba para cada módulo");
  for (const [, classes] of triggers) {
    assert.match(classes, /\bh-11\b/);
    assert.match(classes, /\bsm:h-9\b/);
  }
});

test("/parcelamentos redireciona para a aba de parcelamentos", () => {
  const src = read("../routes/parcelamentos.tsx");
  assert.match(src, /redirect\(/);
  assert.match(src, /to:\s*"\/recorrencias"/);
  assert.match(src, /aba:\s*"parcelamentos"/);
  assert.doesNotMatch(
    src,
    /<AppShell>/,
    "a tela mora no painel, não na rota antiga",
  );
});

// ---------------------------------------------------------------------------
// Painéis
// ---------------------------------------------------------------------------

test("o painel de parcelamentos mantém o contrato da tela antiga", () => {
  assert.ok(
    existsSync(path("../components/installments/InstallmentsPanel.tsx")),
  );
  const src = read("../components/installments/InstallmentsPanel.tsx");
  assert.match(src, /api\.get<Installment\[\]>\(INSTALLMENTS_ENDPOINT\)/);
  assert.match(src, /label="Saldo comprometido"/);
  assert.doesNotMatch(src, /<AppShell>/, "o shell é da rota, não do painel");
  assert.doesNotMatch(
    src,
    /<PageHeader/,
    "o cabeçalho é da rota, não do painel",
  );
});

test("o painel de assinaturas lê a lista e o resumo do backend e não soma dinheiro", () => {
  assert.ok(
    existsSync(path("../components/subscriptions/SubscriptionsPanel.tsx")),
  );
  const src = read("../components/subscriptions/SubscriptionsPanel.tsx");
  assert.match(src, /api\.get<Subscription\[\]>\(SUBSCRIPTIONS_ENDPOINT\)/);
  assert.match(src, /api\.get<SubscriptionsSummary>\(SUMMARY_ENDPOINT\)/);
  assert.match(src, /summary\.data\.monthly_amount/);
  assert.doesNotMatch(
    src,
    /\.reduce\(|parseMoney\(|parseFloat\(/,
    "o front não soma dinheiro",
  );
  assert.match(
    src,
    /text-2xl font-semibold tabular-nums whitespace-nowrap/,
    "valor sem quebra (M-13)",
  );
});

test("assinaturas: ações com 44 px no toque e esconder no hover só onde há hover", () => {
  const src = read("../components/subscriptions/SubscriptionsPanel.tsx");
  assert.match(src, /h-11 w-11 lg:h-8 lg:w-8/);
  assert.doesNotMatch(src, /\bopacity-0\b/, "ação invisível no toque (P2)");
});

test("os endpoints de coleção não levam barra final (D-Vercel-3)", () => {
  const src = read("../components/subscriptions/SubscriptionsPanel.tsx");
  assert.match(src, /SUBSCRIPTIONS_ENDPOINT = "\/subscriptions";/);
  assert.match(src, /SUMMARY_ENDPOINT = "\/subscriptions\/summary";/);
});

// ---------------------------------------------------------------------------
// Query keys e sincronização ao abrir
// ---------------------------------------------------------------------------

test("criar, editar ou excluir assinatura invalida tudo que ela toca", () => {
  const keys = SUBSCRIPTION_QUERY_KEYS.map((k) => k[0]).sort();
  assert.deepEqual(keys, [
    "accounts",
    "categories",
    "dashboard",
    "reports",
    "subscriptions",
    "transactions",
  ]);
});

test("o `sync` roda ao abrir o app, depois do login, e atualiza as telas", () => {
  assert.ok(
    existsSync(path("../components/subscriptions/SubscriptionSync.tsx")),
  );
  const sync = read("../components/subscriptions/SubscriptionSync.tsx");
  assert.match(sync, /\.post<[^>]*>\(\s*"\/subscriptions\/sync"/);
  assert.match(sync, /SUBSCRIPTION_QUERY_KEYS/);

  const gate = read("../components/auth/AuthGate.tsx");
  const at = gate.indexOf("<SubscriptionSync");
  const loginAt = gate.indexOf("<GoogleSignIn");
  assert.ok(at > loginAt, "o sync só pode montar na parte autenticada do gate");
});

test("os diálogos de assinatura seguem o formulário mobile (M-3): folha, rodapé fixo, 44 px", () => {
  const form = read("../components/subscriptions/SubscriptionFormDialog.tsx");
  assert.match(
    form,
    /max-sm:bottom-\[calc\(env\(safe-area-inset-bottom\)\+0\.5rem\)\]/,
  );
  assert.match(form, /overflow-y-auto/);
  assert.match(form, /h-11 sm:h-9/);
  // Valor com máscara (T-3): o MoneyInput traz o inputMode numérico.
  assert.match(form, /<MoneyInput\b/);
  assert.match(form, /onOpenAutoFocus/);
  assert.doesNotMatch(form, /\bautoFocus\b(?!\s*\n?\s*\/>)/m);

  const del = read("../components/subscriptions/DeleteSubscriptionDialog.tsx");
  assert.match(del, /max-sm:w-\[calc\(100%-2rem\)\] max-sm:rounded-lg/);
  assert.match(del, /h-11 sm:h-9/);
  assert.match(del, /api\.delete\(`\/subscriptions\/\$\{shown!\.id\}`\)/);
});
