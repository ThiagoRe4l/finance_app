"""Calendário de cobrança da assinatura — funções puras, sem banco (R-2).

Escrito **antes** da implementação (`docs/recorrencias.md`). Hoje todos ficam
vermelhos por `ModuleNotFoundError: app.subscription_schedule`: o módulo não existe.

`charge_dates(first_charge_date, through, *, after=None, ended_on=None)` devolve as
datas de cobrança com `after < data <= through` (`after` nulo = sem piso além da
primeira cobrança), em ordem, e nenhuma depois de `ended_on` (inclusive).
"""

import datetime

from app.subscription_schedule import charge_dates

D = datetime.date


def test_one_charge_per_month_on_the_billing_day():
    assert charge_dates(D(2026, 1, 15), D(2026, 4, 20)) == [
        D(2026, 1, 15), D(2026, 2, 15), D(2026, 3, 15), D(2026, 4, 15),
    ]


def test_nothing_is_charged_before_the_first_charge_date():
    assert charge_dates(D(2026, 3, 15), D(2026, 3, 14)) == []
    assert charge_dates(D(2026, 3, 15), D(2026, 3, 15)) == [D(2026, 3, 15)]


def test_the_through_date_is_inclusive():
    assert charge_dates(D(2026, 1, 15), D(2026, 2, 15)) == [D(2026, 1, 15), D(2026, 2, 15)]
    assert charge_dates(D(2026, 1, 15), D(2026, 2, 14)) == [D(2026, 1, 15)]


def test_after_is_exclusive_so_a_charge_is_never_listed_twice():
    assert charge_dates(D(2026, 1, 15), D(2026, 4, 20), after=D(2026, 2, 15)) == [
        D(2026, 3, 15), D(2026, 4, 15),
    ]


def test_day_31_is_clamped_to_the_end_of_short_months_and_comes_back():
    # A âncora é o dia 31 da primeira cobrança, nunca a data já limitada: 28/02
    # não puxa março para 28.
    assert charge_dates(D(2026, 1, 31), D(2026, 5, 31)) == [
        D(2026, 1, 31), D(2026, 2, 28), D(2026, 3, 31), D(2026, 4, 30), D(2026, 5, 31),
    ]


def test_leap_day_charges_on_the_28th_in_common_years():
    assert charge_dates(D(2028, 2, 29), D(2030, 3, 1)) == [
        D(2028, 2, 29), D(2028, 3, 29), D(2028, 4, 29), D(2028, 5, 29),
        D(2028, 6, 29), D(2028, 7, 29), D(2028, 8, 29), D(2028, 9, 29),
        D(2028, 10, 29), D(2028, 11, 29), D(2028, 12, 29), D(2029, 1, 29),
        D(2029, 2, 28), D(2029, 3, 29), D(2029, 4, 29), D(2029, 5, 29),
        D(2029, 6, 29), D(2029, 7, 29), D(2029, 8, 29), D(2029, 9, 29),
        D(2029, 10, 29), D(2029, 11, 29), D(2029, 12, 29), D(2030, 1, 29),
        D(2030, 2, 28),
    ]


def test_the_year_boundary_is_crossed():
    assert charge_dates(D(2026, 11, 10), D(2027, 2, 10)) == [
        D(2026, 11, 10), D(2026, 12, 10), D(2027, 1, 10), D(2027, 2, 10),
    ]


def test_ended_on_stops_the_charges_and_is_inclusive():
    assert charge_dates(D(2026, 1, 15), D(2026, 12, 31), ended_on=D(2026, 3, 15)) == [
        D(2026, 1, 15), D(2026, 2, 15), D(2026, 3, 15),
    ]
    assert charge_dates(D(2026, 1, 15), D(2026, 12, 31), ended_on=D(2026, 3, 14)) == [
        D(2026, 1, 15), D(2026, 2, 15),
    ]


def test_ended_before_the_first_charge_means_no_charge_at_all():
    assert charge_dates(D(2026, 5, 15), D(2026, 12, 31), ended_on=D(2026, 5, 14)) == []


def test_an_infinite_subscription_is_bounded_by_through_not_by_a_count():
    dates = charge_dates(D(2020, 1, 1), D(2026, 11, 13))
    assert len(dates) == 83  # jan/2020 a nov/2026, inclusive
    assert dates[-1] == D(2026, 11, 1)
