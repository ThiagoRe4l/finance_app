/**
 * Caderno, fatia C4 — Categorias e Recorrências (`docs/tema.md`, D-Cad-8).
 *
 * Escrito **antes** da implementação (aprovação delegada pelo usuário em
 * 18/11/2026). Função pura da trilha de parcelas mais o contrato sobre os
 * cartões.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { installmentTrack } from "./installments.ts";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// ── installmentTrack ─────────────────────────────────────────────────────

test("parcela 3 de 10: duas pagas, a terceira é a atual, sete faltam", () => {
  assert.deepEqual(installmentTrack(3, 10), [
    "paid",
    "paid",
    "current",
    "due",
    "due",
    "due",
    "due",
    "due",
    "due",
    "due",
  ]);
});

test("primeira parcela: nenhuma paga", () => {
  assert.deepEqual(installmentTrack(1, 3), ["current", "due", "due"]);
});

test("quitado (atual > total): todas pagas, nenhuma atual", () => {
  assert.deepEqual(installmentTrack(13, 12), Array(12).fill("paid"));
  assert.deepEqual(installmentTrack(40, 3), ["paid", "paid", "paid"]);
});

test("a regra das pagas é a mesma de installmentProgress (atual − 1)", () => {
  const track = installmentTrack(7, 12)!;
  assert.equal(track.filter((s) => s === "paid").length, 6);
});

test("acima de 36 parcelas não há trilha (o cartão fica com a barra)", () => {
  assert.equal(installmentTrack(2, 36)!.length, 36);
  assert.equal(installmentTrack(2, 37), null);
  assert.equal(installmentTrack(2, 120), null);
});

test("total inválido não tem trilha", () => {
  assert.equal(installmentTrack(1, 0), null);
  assert.equal(installmentTrack(1, -3), null);
});

// ── Cartões ──────────────────────────────────────────────────────────────

const PANEL = read("../components/installments/InstallmentsPanel.tsx");
const CARD = PANEL.slice(PANEL.indexOf("function InstallmentCard"));

test("parcelamento: a trilha vem de installmentTrack, como imagem rotulada", () => {
  assert.match(PANEL, /installmentTrack,?/);
  assert.match(CARD, /installmentTrack\(\s*installment\.current_installment,/);
  assert.match(CARD, /role="img"/);
  assert.match(CARD, /aria-label=\{`Parcela \$\{/);
});

test("parcelamento: sem trilha, a barra contínua continua", () => {
  assert.match(CARD, /track === null/);
  assert.match(CARD, /width: `\$\{progress\.percent\}%`/);
});

test("parcelamento: título e valores em Fraunces", () => {
  assert.match(
    CARD,
    /<p className="[^"]*\bfont-display\b[^"]*">\s*\{installment\.title\}/,
  );
  assert.match(
    CARD,
    /className="[^"]*\bfont-display\b[^"]*">\s*\{formatBRL\(installment\.remaining_amount\)\}/,
  );
});

test("categoria: nome em Fraunces, com a quebra da M-16", () => {
  assert.match(
    read("../routes/categorias.tsx"),
    /<p className="[^"]*\bfont-display\b[^"]*\bwrap-anywhere\b[^"]*">\{category\.name\}/,
  );
});

test("assinatura: título e valor por mês em Fraunces", () => {
  const src = read("../components/subscriptions/SubscriptionsPanel.tsx");
  assert.match(
    src,
    /<p className="[^"]*\bfont-display\b[^"]*">\s*\{subscription\.title\}/,
  );
  assert.match(
    src,
    /<p className="[^"]*\bfont-display\b[^"]*\bwhitespace-nowrap\b[^"]*">\s*\{formatBRL\(subscription\.amount\)\}/,
  );
});
