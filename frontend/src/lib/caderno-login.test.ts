/**
 * Caderno, fatia C6 — login (`docs/tema.md`, D-Cad-10).
 *
 * Escrito **antes** da implementação (aprovação delegada pelo usuário em
 * 18/11/2026). Teste sobre arquivo: a autenticação não muda, só a tela.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { tagAt, classesIn } from "./jsx-source.ts";

const SRC = readFileSync(
  fileURLToPath(
    new URL("../components/auth/GoogleSignIn.tsx", import.meta.url),
  ),
  "utf8",
);

const tag = (needle: string) => {
  const at = SRC.indexOf(needle);
  assert.ok(at >= 0, `sem ${needle}`);
  return tagAt(SRC, at);
};

test("fundo papel pautado, só CSS, e a altura dinâmica de sempre (P5)", () => {
  const root = SRC.slice(SRC.lastIndexOf("return ("));
  assert.match(root, /repeating-linear-gradient/);
  assert.match(root, /\bmin-h-dvh\b/);
  assert.doesNotMatch(root, /\b(h-screen|min-h-screen|100vh)\b/);
});

test("a marca e o nome em Fraunces grande", () => {
  assert.match(
    SRC,
    /import \{ BrandMark \} from "@\/components\/shared\/BrandMark";/,
  );
  assert.match(SRC, /<BrandMark\b/);
  const h1 = tag("<h1");
  for (const t of ["font-display", "text-6xl"]) {
    assert.ok(classesIn(h1).includes(t), `${t} fora de ${h1}`);
  }
});

test("a frase do canvas e o texto de acesso restrito", () => {
  assert.match(SRC, /Seu caderno de contas, em ordem\./);
  assert.match(SRC, /Organizador financeiro pessoal\. O acesso é restrito\./);
});

test("o botão oficial do Google dentro de um cartão branco, perto do polegar", () => {
  const button = SRC.indexOf("ref={buttonRef}");
  assert.ok(button >= 0, "sem o contêiner do GSI");
  const card = tagAt(
    SRC,
    SRC.lastIndexOf("<div", SRC.lastIndexOf("bg-card", button)),
  );
  for (const t of ["bg-card", "border", "rounded-2xl", "mt-auto"]) {
    assert.ok(classesIn(card).includes(t), `${t} fora de ${card}`);
  }
  assert.match(SRC, /renderButton\(/, "o botão continua o do GSI");
});

test("o erro é um aviso com ícone, ainda role=alert, com o texto do backend", () => {
  // A tag que abre o aviso: o atributo vem depois do className.
  const alert = tagAt(SRC, SRC.lastIndexOf("<p", SRC.indexOf('role="alert"')));
  assert.ok(classesIn(alert).includes("bg-destructive/10"), alert);
  const after = SRC.slice(SRC.indexOf('role="alert"'));
  assert.match(after.slice(0, 400), /<AlertCircle\b/);
  assert.match(after.slice(0, 600), /\{error\}/);
});
