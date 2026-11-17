from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
import datetime
from decimal import Decimal
from typing import List

from app.tenancy import owned_db
from app import models, schemas
from app.routers.categories import _aggregated_rows, _to_response
from app.periods import month_bounds, shift_month
from app import period_aggregates as agg
from app import installment_metrics, subscription_metrics
from app import account_balance

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"]
)

# Dinheiro é Decimal em toda a API. `Decimal("0.00")` e não `Decimal(0)`
# porque a **escala** faz parte do contrato: o front recebe string e precisa que
# `"0.00"` seja previsível, inclusive quando a agregação não encontra linha
# nenhuma. Misturar este fallback com `0.0` float levanta TypeError na primeira
# subtração — ver `test_money_precision.py`.
ZERO = Decimal("0.00")


@router.get("/summary", response_model=schemas.DashboardSummary)
def get_dashboard_summary(
    period: Optional[str] = Query(
        None, description="YYYY-MM, YYYY, YYYY-MM..YYYY-MM, 3m, 6m, 12m ou all. Ausente = mês corrente."
    ),
    db: Session = Depends(owned_db),
):
    """Resumo do período escolhido (`docs/periodos.md`). Sem `period`, o mês corrente."""
    chosen = agg.resolve_period(db, period)
    today = datetime.date.today()

    # 1. Saldo do período (PER-5). O `CASE` de sinal vem de `app/account_balance.py`,
    # o mesmo que `GET /accounts` usa; a igualdade entre os dois endpoints é travada
    # por `test_total_balance_matches_the_sum_of_the_accounts`.
    total_balance = agg.balance_for_period(db, chosen)

    # 2. Receitas e despesas do período. Intervalo semiaberto, o mesmo do gráfico.
    # `expenses` já inclui a assinatura projetada (PER-4); `projected` é só essa parte.
    totals = agg.period_totals(db, chosen.start, chosen.end)
    total_revenues = totals.revenues
    total_expenses = totals.expenses
    total_savings = total_revenues - total_expenses

    # 3. Fluxo mensal: contexto, não recorte (PER-3).
    monthly_flow = agg.monthly_flow(db, chosen.chart)

    # 3.1. Variações percentuais: só fazem sentido contra o mês anterior, então só
    # existem quando o período é um mês.
    expenses_change_pct = None
    balance_change_pct = None
    if chosen.kind == "month":
        previous_month = monthly_flow[-2]
        if previous_month.outcome:
            expenses_change_pct = float(
                (total_expenses - previous_month.outcome) / previous_month.outcome * 100
            )
        # Saldo ao fim do mês anterior, calculado direto (S-1). `abs()` no
        # denominador: com saldo anterior negativo, a divisão direta inverteria o
        # sinal e uma economia positiva apareceria como variação negativa.
        balance_prev_month_end = account_balance.total_balance(
            db, until=chosen.start - datetime.timedelta(days=1)
        )
        if balance_prev_month_end:
            balance_change_pct = float(total_savings / abs(balance_prev_month_end) * 100)

    savings_pct_of_revenue = None
    if total_revenues:
        savings_pct_of_revenue = float(total_savings / total_revenues * 100)

    # 4. Transações do período.
    recent_txs = db.query(models.Transaction).options(
        joinedload(models.Transaction.installment),
        joinedload(models.Transaction.category)
    ).filter(
        models.Transaction.date >= chosen.start,
        models.Transaction.date < chosen.end,
    ).order_by(models.Transaction.date.desc(), models.Transaction.id.desc()).limit(7).all()

    # 5. Distribuição de categorias no período, com a assinatura projetada.
    projected_by_category = {}
    for charge in agg.projected_charges(db, chosen.start, chosen.end):
        projected_by_category[charge.category_id] = (
            projected_by_category.get(charge.category_id, ZERO) + charge.amount
        )
    categories_dist = []
    for row in _aggregated_rows(db, bounds=(chosen.start, chosen.end)):
        response = _to_response(row)
        extra = projected_by_category.get(response.id)
        if extra:
            response = response.model_copy(update={"spent": response.spent + extra})
        categories_dist.append(response)

    # 6. Parcelamentos — só os que ainda têm parcela a pagar.
    #
    # A regra de "ativo" vive em `app/installment_metrics.py`, compartilhada com
    # `GET /installments/summary`. Duplicá-la aqui é como o `<=` viraria `<` de
    # um lado só, e a mesma métrica passaria a ter dois valores no mesmo app.
    #
    # O filtro vale só para estas agregações: `GET /installments` continua
    # devolvendo o histórico completo, quitados incluídos.
    active_installments = installment_metrics.active_installments(db)
    committed = installment_metrics.monthly_committed(active_installments)

    # 7. Assinaturas (R-7). Os campos de parcelamento acima não mudam de sentido;
    # o total das duas coisas é somado aqui, em `Decimal`, e não no front.
    active_subs = subscription_metrics.active_subscriptions(db)
    subscriptions_amount = subscription_metrics.monthly_amount(active_subs)
    
    return schemas.DashboardSummary(
        total_balance=total_balance,
        total_revenues=total_revenues,
        total_expenses=total_expenses,
        total_savings=total_savings,
        monthly_flow=monthly_flow,
        recent_transactions=recent_txs,
        category_distribution=categories_dist,
        active_installments_count=len(active_installments),
        monthly_committed_amount=committed,
        active_subscriptions_count=len(active_subs),
        monthly_subscriptions_amount=subscriptions_amount,
        monthly_recurring_amount=committed + subscriptions_amount,
        balance_change_pct=balance_change_pct,
        expenses_change_pct=expenses_change_pct,
        savings_pct_of_revenue=savings_pct_of_revenue,
        period=agg.period_info(chosen),
        projected_expenses=totals.projected,
        is_projection=agg.is_projection(chosen),
    )
