from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from decimal import Decimal

from app.tenancy import owned_db
from app import models, schemas
from app import period_aggregates as agg

router = APIRouter(
    prefix="/reports",
    tags=["Reports"]
)


@router.get("/overview", response_model=schemas.ReportSummary)
def get_report_overview(
    period: Optional[str] = Query(
        None, description="YYYY-MM, YYYY, YYYY-MM..YYYY-MM, 3m, 6m, 12m ou all. Ausente = mês corrente."
    ),
    db: Session = Depends(owned_db),
):
    """Relatório do período escolhido (`docs/periodos.md`). Sem `period`, o mês
    corrente; `6m` é o recorte que esta rota tinha antes do filtro."""
    chosen = agg.resolve_period(db, period)

    # Totais e gráfico saem das mesmas funções do Dashboard (`period_aggregates`),
    # para os dois não divergirem no mesmo período.
    totals = agg.period_totals(db, chosen.start, chosen.end)
    flow = agg.monthly_flow(db, chosen.chart)

    # `average_savings` é média, não dinheiro: a divisão gera dízima e o campo
    # continua `float` no schema. Divide pelos meses do período.
    avg_saving = float(totals.revenues - totals.expenses) / chosen.months_in_period

    # Maiores categorias: o mesmo recorte de data dos totais (sem ele, a maior
    # categoria chegava a valer 10× o total — o defeito de 10/08/2026), mais a
    # assinatura projetada. Agrupa pela FK e resolve o nome via join.
    rows = db.query(
        models.Category.id,
        models.Category.name,
        func.sum(models.Transaction.amount),
    ).join(
        models.Transaction, models.Transaction.category_id == models.Category.id
    ).filter(
        models.Transaction.type == "SAÍDA",
        models.Transaction.date >= chosen.start,
        models.Transaction.date < chosen.end,
    ).group_by(models.Category.id).all()

    by_category = {cid: [name, total] for cid, name, total in rows}
    names = None
    for charge in agg.projected_charges(db, chosen.start, chosen.end):
        if charge.category_id not in by_category:
            if names is None:
                names = {c.id: c.name for c in db.query(models.Category).all()}
            by_category[charge.category_id] = [names[charge.category_id], Decimal("0.00")]
        by_category[charge.category_id][1] += charge.amount

    ranked = sorted(by_category.values(), key=lambda item: item[1], reverse=True)[:4]
    top_categories = [schemas.CategoryReport(name=name, value=value) for name, value in ranked]

    return schemas.ReportSummary(
        total_revenues=totals.revenues,
        total_expenses=totals.expenses,
        average_savings=avg_saving,
        monthly_comparative=flow,
        top_categories=top_categories,
        period=agg.period_info(chosen),
        projected_expenses=totals.projected,
        is_projection=agg.is_projection(chosen),
    )
