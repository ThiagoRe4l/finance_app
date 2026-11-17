/**
 * `subscriptions.ts` — derivações da aba de assinaturas (`docs/recorrencias.md`).
 *
 * Escrito **antes** da implementação (13/11/2026): hoje fica vermelho porque o
 * módulo não existe. O front não calcula cobrança nem soma dinheiro: `status`,
 * `next_charge_date` e o resumo vêm prontos do backend. Sobra o texto do card.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  billingDay,
  describeCharge,
  type Subscription,
} from "./subscriptions.ts";

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    title: "Netflix",
    amount: "49.90",
    category_id: 3,
    account_id: 1,
    first_charge_date: "2026-09-15",
    ended_on: null,
    status: "ativa",
    next_charge_date: "2026-12-15",
    category: {
      id: 3,
      name: "Lazer",
      color: "oklch(0.6 0.1 40)",
      icon_name: "Tv",
    },
    ...overrides,
  };
}

test("billingDay: o dia da primeira cobrança, sem passar por Date (fuso)", () => {
  assert.equal(billingDay("2026-09-15"), 15);
  assert.equal(billingDay("2026-01-01"), 1);
  assert.equal(billingDay("2025-12-31"), 31);
});

test("describeCharge: ativa mostra o dia e a próxima cobrança em dd/mm/aaaa", () => {
  assert.equal(
    describeCharge(subscription()),
    "Todo dia 15 · próxima em 15/12/2026",
  );
});

test("describeCharge: encerrada não promete próxima cobrança", () => {
  assert.equal(
    describeCharge(
      subscription({
        status: "encerrada",
        next_charge_date: null,
        ended_on: "2026-11-13",
      }),
    ),
    "Encerrada · cobrava todo dia 15",
  );
});

test("describeCharge: o dia 31 continua 'dia 31' (o backend limita em mês curto)", () => {
  assert.equal(
    describeCharge(
      subscription({
        first_charge_date: "2025-12-31",
        next_charge_date: "2026-11-30",
      }),
    ),
    "Todo dia 31 · próxima em 30/11/2026",
  );
});
