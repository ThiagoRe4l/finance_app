/**
 * `date.ts` — formatação das datas devolvidas pela API.
 *
 * Escrito **antes** da implementação. A API devolve `date` em ISO
 * (`"2026-08-07"`) e a tela de Transações exibe `dd/MM` (`"07/08"`), como no
 * mock original.
 *
 * Por que isso não é um `toLocaleDateString` e pronto
 * ---------------------------------------------------
 * `new Date("2026-08-07")` é interpretado como **meia-noite UTC**. Em qualquer
 * fuso negativo — inclusive o do Brasil — isso volta um dia:
 *
 *     TZ=America/Sao_Paulo node -e 'console.log(new Date("2026-08-07").getDate())'
 *     6
 *
 * Ou seja, a implementação ingênua erra a data de **toda** transação da tela, e
 * erra de um jeito plausível: o número existe, só está errado. Estes testes
 * fixam o parse manual.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatFullDate, formatShortDate, parseISODate, toISODate } from "./date.ts";

test("formata a data ISO como dd/MM", () => {
  assert.equal(formatShortDate("2026-08-07"), "07/08");
});

test("preserva o dia em fuso negativo — a armadilha do new Date(ISO)", () => {
  /*
   * O teste roda no TZ do ambiente, mas o parse não pode depender dele: a
   * implementação correta nunca constrói um `Date` a partir da string ISO.
   */
  const original = process.env.TZ;
  try {
    process.env.TZ = "America/Sao_Paulo";
    assert.equal(formatShortDate("2026-08-07"), "07/08");
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14, o outro extremo
    assert.equal(formatShortDate("2026-08-07"), "07/08");
  } finally {
    process.env.TZ = original;
  }
});

test("preenche dia e mês com zero à esquerda", () => {
  assert.equal(formatShortDate("2026-01-05"), "05/01");
});

test("aceita o primeiro e o último dia do ano", () => {
  assert.equal(formatShortDate("2026-01-01"), "01/01");
  assert.equal(formatShortDate("2026-12-31"), "31/12");
});

test("rejeita entrada que não é uma data ISO", () => {
  // Mesma postura de `parseMoney`: falha visível em vez de "NaN/NaN" na tela.
  assert.throws(() => formatShortDate("07/08/2026"), /data inválida/i);
  assert.throws(() => formatShortDate(""), /data inválida/i);
  assert.throws(() => formatShortDate(null as unknown as string), /data inválida/i);
});


// ---------------------------------------------------------------------------
// Ponte com o date picker: ISO da API ↔ `Date` do react-day-picker
// ---------------------------------------------------------------------------
//
// O `Calendar` trabalha com `Date`; a API, com `"2026-08-07"`. As duas
// conversões ingênuas erram em **hemisférios opostos**, que é por que nenhuma
// aparece testando do Brasil:
//
//   new Date("2026-08-07")        -> dia 6 em fuso NEGATIVO (meia-noite UTC)
//   date.toISOString().slice(10)  -> dia 6 em fuso POSITIVO (local -> UTC)
//
// Verificado em America/Sao_Paulo, Asia/Tokyo e Pacific/Kiritimati.

function withTZ(tz: string, run: () => void) {
  const original = process.env.TZ;
  try {
    process.env.TZ = tz;
    run();
  } finally {
    process.env.TZ = original;
  }
}

const TIMEZONES = ["America/Sao_Paulo", "Asia/Tokyo", "Pacific/Kiritimati", "UTC"];

test("parseISODate devolve o dia certo em qualquer fuso", () => {
  for (const tz of TIMEZONES) {
    withTZ(tz, () => {
      const date = parseISODate("2026-08-07");
      assert.equal(date.getFullYear(), 2026, tz);
      assert.equal(date.getMonth(), 7, tz);   // 0-indexado
      assert.equal(date.getDate(), 7, tz);
    });
  }
});

test("toISODate usa os componentes locais, não UTC", () => {
  /*
   * A armadilha do outro lado: `toISOString()` converte para UTC antes de
   * cortar, então meia-noite local em fuso positivo vira o dia anterior.
   */
  for (const tz of TIMEZONES) {
    withTZ(tz, () => {
      assert.equal(toISODate(new Date(2026, 7, 7)), "2026-08-07", tz);
    });
  }
});

test("o ciclo ISO -> Date -> ISO não perde o dia", () => {
  for (const tz of TIMEZONES) {
    withTZ(tz, () => {
      for (const iso of ["2026-01-01", "2026-08-07", "2026-12-31", "2024-02-29"]) {
        assert.equal(toISODate(parseISODate(iso)), iso, `${tz} ${iso}`);
      }
    });
  }
});

test("formatFullDate mostra a data por extenso curta, para o botão do picker", () => {
  // `formatShortDate` ("07/08") serve à tabela, onde a coluna é estreita e o
  // ano é redundante. No formulário o ano importa.
  assert.equal(formatFullDate("2026-08-07"), "07/08/2026");
  assert.equal(formatFullDate("2026-01-05"), "05/01/2026");
});

test("as duas conversões recusam entrada inválida", () => {
  assert.throws(() => parseISODate("07/08/2026"), /data inválida/i);
  assert.throws(() => parseISODate(""), /data inválida/i);
  assert.throws(() => formatFullDate("qualquer coisa"), /data inválida/i);
});

test("toISODate recusa Date inválido", () => {
  // `new Date("lixo")` é um `Date` cujo tempo é NaN; formatá-lo daria
  // "NaN-NaN-NaN" indo direto para o payload.
  assert.throws(() => toISODate(new Date("lixo")), /data inválida/i);
});
