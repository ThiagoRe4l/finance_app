/**
 * Contrato do formulário de transação no celular — fatia 2a da reforma
 * mobile-first (`docs/mobile-first.md` → M-3, M-12).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md. Teste
 * sobre arquivo, como as fatias anteriores: componente React não tem teste
 * neste container. Teclado, animação e rolagem real ficam com a conferência
 * no aparelho (M-12, "Verificação pelo usuário").
 *
 * A folha é posta embaixo com variantes `max-sm:` sobre as classes do
 * `ui/dialog`, que não se edita: a partir de `sm` as classes do shadcn ficam
 * sem nenhuma sobreposição, e o diálogo é o de hoje por construção.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const FORM = "../components/transactions/TransactionFormDialog.tsx";
const DELETE = "../components/transactions/DeleteTransactionDialog.tsx";
const CATEGORY_SELECT = "../components/shared/CategorySelect.tsx";

/**
 * A tag de abertura que começa no `<` em `from`, até o `>` que a fecha,
 * pulando `{...}` e strings (o `=>` de uma expressão não encerra a tag).
 */
function tagAt(source: string, from: number): string {
  assert.ok(from >= 0, "tag não encontrada");
  let depth = 0;
  let quote: string | null = null;
  let i = from + 1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) break;
  }
  return source.slice(from, i + 1);
}

/** A tag de abertura `<Nome …>` que contém o atributo `attr` (ex.: `id="tx-title"`). */
function tagWith(source: string, name: string, attr: string): string {
  const re = new RegExp(`<${name}\\b`, "g");
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const tag = tagAt(source, m.index);
    if (tag.includes(attr)) return tag;
  }
  assert.fail(`<${name} ${attr}> não encontrado`);
}

/** Os tokens do `className="…"` literal de uma tag. */
function classesIn(tag: string): string[] {
  const m = /className="([^"]*)"/.exec(tag);
  assert.ok(m, `sem className literal em: ${tag.slice(0, 80)}`);
  return m[1].split(/\s+/).filter(Boolean);
}

function assertTokens(tag: string, expected: string[]) {
  const cls = classesIn(tag);
  const missing = expected.filter((t) => !cls.includes(t));
  assert.deepEqual(missing, [], `faltam em: ${cls.join(" ")}`);
}

// ── Folha ancorada embaixo, só abaixo de sm ──────────────────────────────

test("DialogContent: ancorado embaixo abaixo de sm, com margem, cantos e área segura", () => {
  const tag = tagWith(read(FORM), "DialogContent", "className");
  assertTokens(tag, [
    "max-sm:top-auto",
    "max-sm:bottom-[calc(env(safe-area-inset-bottom)+0.5rem)]",
    "max-sm:left-2",
    "max-sm:right-2",
    // `w-full` do base + `left-2 right-2` estouraria 8 px à direita: o
    // `w-auto` deixa as duas bordas decidirem, e `max-w-none` solta o `max-w-lg`.
    "max-sm:w-auto",
    "max-sm:max-w-none",
    "max-sm:translate-x-0",
    "max-sm:translate-y-0",
    "max-sm:rounded-xl",
    // A altura desconta as duas áreas seguras: com `viewport-fit=cover`, o
    // topo de um formulário longo iria para baixo do entalhe.
    "max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)]",
  ]);
});

test("DialogContent: a animação de entrada e saída sobe de baixo, sem a diagonal do centro", () => {
  // As classes do `ui/dialog` animam de `left-1/2` e `top-[48%]`; com a folha
  // embaixo isso a faria entrar voando do canto. Mais variantes = regra depois
  // no CSS, então as `max-sm:` vencem as do shadcn abaixo de sm.
  const tag = tagWith(read(FORM), "DialogContent", "className");
  assertTokens(tag, [
    "max-sm:data-[state=open]:slide-in-from-left-0",
    "max-sm:data-[state=open]:slide-in-from-bottom-8",
    "max-sm:data-[state=closed]:slide-out-to-left-0",
    "max-sm:data-[state=closed]:slide-out-to-bottom-8",
    // O `zoom-in-95`/`zoom-out-95` do shadcn também sai: a folha só desliza.
    "max-sm:data-[state=open]:zoom-in-100",
    "max-sm:data-[state=closed]:zoom-out-100",
  ]);
});

test("DialogContent: coluna com altura em dvh; quem rola é o miolo, não o diálogo inteiro", () => {
  const tag = tagWith(read(FORM), "DialogContent", "className");
  assertTokens(tag, [
    "flex",
    "flex-col",
    "overflow-hidden",
    "max-h-[90dvh]",
    "sm:max-w-lg",
    // No toque o foco vai para o próprio diálogo: sem contorno em volta da folha.
    "outline-none",
  ]);
  assert.ok(
    !classesIn(tag).includes("overflow-y-auto"),
    "o DialogContent não rola mais: o rodapé rolaria junto",
  );
});

test("o miolo rola por dentro e o DialogFooter fica fora da rolagem", () => {
  const src = read(FORM);
  const form = tagWith(src, "form", "onSubmit");
  assertTokens(form, ["flex", "min-h-0", "flex-1", "flex-col"]);

  const bodyAt = src.search(/<div className="[^"]*\boverflow-y-auto\b/);
  assert.ok(bodyAt >= 0, "sem miolo com overflow-y-auto");
  // `-mx-1 px-1`: folga para o anel de foco dos campos não ser cortado pela
  // rolagem, que corta também na horizontal.
  assertTokens(tagAt(src, bodyAt), [
    "min-h-0",
    "flex-1",
    "overflow-y-auto",
    "-mx-1",
    "px-1",
  ]);

  const fieldAt = src.indexOf('id="tx-title"');
  const footerAt = src.indexOf("<DialogFooter");
  assert.ok(
    bodyAt < fieldAt && fieldAt < footerAt,
    "ordem: miolo, campos, rodapé",
  );
  // O miolo fecha antes do rodapé: entre os dois, cada <div aberta foi fechada.
  const between = src.slice(bodyAt, footerAt);
  const opened = (between.match(/<div\b/g) ?? []).length;
  const closed = (between.match(/<\/div>/g) ?? []).length;
  assert.equal(opened, closed, "o DialogFooter está dentro do miolo rolável");
});

// ── Alvos de 44 px ───────────────────────────────────────────────────────

test("rodapé: Cancelar e Criar/Salvar com h-11 sm:h-9, empilhados com folga abaixo de sm", () => {
  const src = read(FORM);
  const footerAt = src.indexOf("<DialogFooter");
  assertTokens(tagAt(src, footerAt), ["max-sm:gap-2"]);
  const footer = src.slice(footerAt, src.indexOf("</DialogFooter>"));
  const buttons = [...footer.matchAll(/<Button\b/g)].map((m) =>
    tagAt(footer, m.index ?? 0),
  );
  assert.equal(buttons.length, 2, "esperados 2 botões no rodapé");
  for (const b of buttons) assertTokens(b, ["h-11", "sm:h-9"]);
});

test("campos: descrição, valor, tipo, parcelamento e data com h-11 sm:h-9", () => {
  const src = read(FORM);
  assertTokens(tagWith(src, "Input", 'id="tx-title"'), ["h-11", "sm:h-9"]);
  assertTokens(tagWith(src, "Input", 'id="tx-amount"'), ["h-11", "sm:h-9"]);
  assertTokens(tagWith(src, "SelectTrigger", 'id="tx-type"'), [
    "h-11",
    "sm:h-9",
  ]);
  assertTokens(tagWith(src, "SelectTrigger", 'id="tx-installment"'), [
    "h-11",
    "sm:h-9",
  ]);
  // O botão de data é o único <Button type="button" variant="outline"> do miolo.
  assertTokens(tagWith(src, "Button", "justify-start font-normal"), [
    "h-11",
    "sm:h-9",
  ]);
});

test("categoria: o CategorySelect repassa a classe ao gatilho, e o formulário pede h-11 sm:h-9", () => {
  // O CategorySelect é compartilhado com Parcelamentos: a prop é opcional, e
  // sem ela o gatilho é o de hoje.
  const select = read(CATEGORY_SELECT);
  assert.match(select, /\btriggerClassName\?:\s*string/);
  assert.match(
    tagWith(select, "SelectTrigger", "id={id}"),
    /className=\{triggerClassName\}/,
  );
  assert.ok(
    tagWith(read(FORM), "CategorySelect", 'id="tx-category"').includes(
      'triggerClassName="h-11 sm:h-9"',
    ),
  );
});

test("Switch: a linha inteira é o alvo, com max-sm:min-h-11", () => {
  // Aceita as duas formas: o rótulo é o próprio invólucro da linha (`<label>`
  // ou `<Label>` com `max-sm:min-h-11`), ou o `<Label>` do shadcn continua
  // onde está e estica a área de clique sobre a linha só abaixo de sm
  // (`max-sm:after:absolute max-sm:after:inset-0`), com a linha
  // `relative max-sm:min-h-11`.
  const src = read(FORM);
  for (const id of ["tx-fixed", "tx-unlink"]) {
    const labels = [
      ...src.matchAll(new RegExp(`<[Ll]abel\\b[^>]*htmlFor="${id}"`, "g")),
    ];
    assert.equal(labels.length, 1, `${id}: esperado um rótulo só`);
    const at = labels[0].index ?? 0;
    const label = classesIn(tagAt(src, at));
    if (label.includes("max-sm:min-h-11")) continue;
    // Só no celular: no desktop a linha se comporta como antes.
    assert.ok(
      label.includes("max-sm:after:absolute") &&
        label.includes("max-sm:after:inset-0"),
      `${id}: o rótulo não cobre a linha abaixo de sm: ${label.join(" ")}`,
    );
    // Estrutura: linha > grade (rótulo + descrição) > rótulo; o Switch vem
    // logo depois da grade, ainda dentro da linha.
    const grid = src.lastIndexOf("<div", at);
    const row = src.lastIndexOf("<div", grid - 1);
    assertTokens(tagAt(src, row), ["relative", "max-sm:min-h-11"]);
    const switchAt = src.indexOf(`id="${id}"`, at);
    assert.ok(switchAt > at, `${id}: Switch não encontrado depois do rótulo`);
    const between = src.slice(at, switchAt);
    assert.equal(
      (between.match(/<\/div>/g) ?? []).length,
      (between.match(/<div\b/g) ?? []).length + 1,
      `${id}: o Switch não está na mesma linha do rótulo`,
    );
  }
});

// ── Foco ao abrir: sem teclado sozinho em tela de toque ──────────────────

test("foco: sem autoFocus na descrição; onOpenAutoFocus decide pelo tipo de ponteiro", () => {
  const src = read(FORM);
  assert.doesNotMatch(
    tagWith(src, "Input", 'id="tx-title"'),
    /\bautoFocus\b/,
    "o autoFocus faz o Radix nem disparar onOpenAutoFocus",
  );
  // O único autoFocus que sobra é o do Calendar, dentro do Popover da data.
  const autoFocus = [...src.matchAll(/\bautoFocus\b/g)];
  assert.equal(autoFocus.length, 1, "esperado só o autoFocus do Calendar");
  assert.ok(
    src.lastIndexOf("<Calendar", autoFocus[0].index) >
      src.lastIndexOf("/>", autoFocus[0].index),
    "o autoFocus restante não está no <Calendar>",
  );

  // Tudo dentro da tag do DialogContent: o handleSubmit também chama
  // preventDefault, e uma busca no arquivo inteiro passaria sem o handler.
  const content = tagWith(src, "DialogContent", "className");
  assert.match(content, /\bonOpenAutoFocus=\{/);
  assert.match(content, /\.preventDefault\(\)/);
  // A ordem dos ramos importa: toque foca o diálogo, mouse foca a descrição.
  assert.match(
    content,
    /if \(window\.matchMedia\("\(pointer: coarse\)"\)\.matches\) \{[^}]*\bcurrentTarget\b[^}]*\.focus\(\)[^}]*\} else \{[^}]*titleRef\.current\?\.focus\(\)/,
  );
  assert.match(tagWith(src, "Input", 'id="tx-title"'), /\bref=\{titleRef\}/);
});

// ── Exclusão: centrada, com margem lateral ──────────────────────────────

test("exclusão: AlertDialog com margem lateral abaixo de sm e botões com h-11 sm:h-9", () => {
  const src = read(DELETE);
  assertTokens(tagWith(src, "AlertDialogContent", "className"), [
    "max-sm:w-[calc(100%-2rem)]",
  ]);
  assertTokens(tagWith(src, "AlertDialogCancel", "className"), [
    "h-11",
    "sm:h-9",
  ]);
  assertTokens(tagWith(src, "AlertDialogAction", "className"), [
    "h-11",
    "sm:h-9",
  ]);
});

// ── O que não pode mudar ─────────────────────────────────────────────────

test("✅ components/ui/ não muda: as classes base do Dialog e do AlertDialog são as de hoje", () => {
  // Regressão: já passa. As classes são copiadas de ui/dialog.tsx e
  // ui/alert-dialog.tsx em 24/10/2026; a folha embaixo é só no ponto de uso.
  const base =
    "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg";
  assert.ok(
    read("../components/ui/dialog.tsx").includes(base),
    "ui/dialog.tsx mudou",
  );
  assert.ok(
    read("../components/ui/alert-dialog.tsx").includes(base),
    "ui/alert-dialog.tsx mudou",
  );
});

test("✅ Dashboard: routes/index.tsx continua abrindo o mesmo formulário, sem mudança", () => {
  // Regressão: já passa. O 2a muda o componente; a rota não é tocada (M-12).
  assert.ok(
    read("../routes/index.tsx").includes(
      "<TransactionFormDialog open={isCreating} onOpenChange={setIsCreating} />",
    ),
  );
});
