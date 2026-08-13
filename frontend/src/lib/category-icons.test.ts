/**
 * `category-icons.ts` — `icon_name` da API → componente do lucide.
 *
 * Escrito **antes** da implementação.
 *
 * O mock guardava a *referência do componente* (`icon: Home`, importado
 * direto); a API devolve a *string* `"Home"`. Falta o mapa entre os dois.
 *
 * Por que precisa de fallback
 * ---------------------------
 * `icon_name` é **string livre** no schema (`String(50)`, sem validação), então
 * uma categoria criada pelo usuário pode trazer qualquer coisa. Um nome
 * desconhecido resolveria para `undefined`, e `<undefined />` derruba a árvore
 * React inteira — a tela some, não só o ícone.
 *
 * Por que mapa explícito e não dinâmico
 * -------------------------------------
 * O lucide exporta 5799 símbolos. Um mapa explícito mantém o bundle previsível
 * e torna visível quais ícones o app suporta; o custo é ter que acrescentar
 * aqui quando surgir um `icon_name` novo — e é justamente por isso que o
 * fallback importa.
 *
 * Este módulo é separado de `categories.ts` de propósito: é o único da pasta
 * `lib/` que depende de uma biblioteca de UI, e isolá-lo evita que o cálculo de
 * orçamento arraste o lucide junto.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Car,
  CircleDashed,
  GraduationCap,
  Home,
  UtensilsCrossed,
} from "lucide-react";

import { FALLBACK_ICON, resolveCategoryIcon } from "./category-icons.ts";

// Os 10 `icon_name` que o seed do backend produz (`app/init_db.py`).
const SEED_ICON_NAMES = [
  "Home",
  "UtensilsCrossed",
  "Car",
  "Gamepad2",
  "HeartPulse",
  "GraduationCap",
  "ShoppingBag",
  "Plus",
  "Laptop",
  "Sofa",
];

test("resolve os nomes conhecidos para o componente certo", () => {
  assert.equal(resolveCategoryIcon("Home"), Home);
  assert.equal(resolveCategoryIcon("UtensilsCrossed"), UtensilsCrossed);
  assert.equal(resolveCategoryIcon("Car"), Car);
  assert.equal(resolveCategoryIcon("GraduationCap"), GraduationCap);
});

test("todos os ícones do seed resolvem sem cair no fallback", () => {
  /*
   * Regressão contra o mapa ficar defasado do seed: um ícone esquecido aqui
   * apareceria como categoria genérica na tela, sem erro nenhum no console.
   */
  for (const name of SEED_ICON_NAMES) {
    assert.notEqual(
      resolveCategoryIcon(name),
      FALLBACK_ICON,
      `"${name}" está no seed do backend mas não no mapa de ícones`,
    );
  }
});

test("nome desconhecido cai no fallback em vez de undefined", () => {
  /*
   * O caso que derrubaria a tela: `icon_name` é string livre, então uma
   * categoria criada pelo usuário pode trazer qualquer valor. `<undefined />`
   * não renderiza um ícone vazio — quebra a árvore inteira.
   */
  assert.equal(resolveCategoryIcon("NaoExiste"), FALLBACK_ICON);
  assert.equal(resolveCategoryIcon("home"), FALLBACK_ICON); // case-sensitive
});

test("string vazia, null e undefined caem no fallback", () => {
  assert.equal(resolveCategoryIcon(""), FALLBACK_ICON);
  assert.equal(resolveCategoryIcon(null as unknown as string), FALLBACK_ICON);
  assert.equal(resolveCategoryIcon(undefined as unknown as string), FALLBACK_ICON);
});

test("o fallback é neutro, não um ícone de erro", () => {
  /*
   * `CircleDashed` foi escolhido por parecer "categoria sem ícone definido", e
   * não "algo deu errado" — o estado é comum e esperado, não uma falha.
   */
  assert.equal(FALLBACK_ICON, CircleDashed);
});

test("resolve sempre para algo renderizável", () => {
  for (const name of [...SEED_ICON_NAMES, "NaoExiste", "", "🙂"]) {
    const icon = resolveCategoryIcon(name);
    assert.ok(icon, `"${name}" resolveu para valor falsy`);
  }
});
