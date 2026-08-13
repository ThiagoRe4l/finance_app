from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
import datetime
from decimal import Decimal
from typing import List

from app.database import get_db
from app import models, schemas
from app.routers.dashboard import get_dashboard_summary
from app.periods import trailing_months_bounds

router = APIRouter(
    prefix="/reports",
    tags=["Reports"]
)

@router.get("/overview", response_model=schemas.ReportSummary)
def get_report_overview(db: Session = Depends(get_db)):
    # 1. Reutiliza parte da lógica do dashboard para pegar o fluxo mensal
    dash = get_dashboard_summary(db)
    
    # 2. Calcula receitas totais e despesas totais dos últimos 6 meses
    # `start` Decimal: sem ele uma lista vazia devolveria `int 0` e a
    # subtração abaixo misturaria os tipos.
    total_in = sum((f.income for f in dash.monthly_flow), Decimal("0.00"))
    total_out = sum((f.outcome for f in dash.monthly_flow), Decimal("0.00"))

    # `average_savings` é média, não dinheiro: a divisão por 6 gera dízima e o
    # campo continua `float` no schema. O `:,.2f` abaixo funciona nos dois tipos.
    avg_saving = float(total_in - total_out) / len(dash.monthly_flow) if dash.monthly_flow else 0.0
    
    # 3. Maiores categorias (top categories)
    # Agrupa pela FK e resolve o nome via join — antes agrupava pela string
    # crua de `Transaction.category`, o que fazia grafias divergentes virarem
    # linhas separadas no relatório.
    #
    # ⚠️ O recorte de data é a parte que faltava. Sem ele, `top_categories`
    # somava o histórico inteiro enquanto os totais acima somavam 6 meses — a
    # maior categoria chegava a valer 10× o total de despesas do período, lado a
    # lado na mesma tela. Mesmo defeito de `_aggregated_rows`, corrigido em
    # 10/08; sobreviveu aqui porque `reports.py` não tinha teste próprio.
    window_start, window_end = trailing_months_bounds(len(dash.monthly_flow))

    top_cats_query = db.query(
        models.Category.name,
        func.sum(models.Transaction.amount).label("total")
    ).join(
        models.Transaction, models.Transaction.category_id == models.Category.id
    ).filter(
        models.Transaction.type == "SAÍDA",
        models.Transaction.date >= window_start,
        models.Transaction.date < window_end
    ).group_by(
        models.Category.id
    ).order_by(
        func.sum(models.Transaction.amount).desc()
    ).limit(4).all()
    
    top_categories = [
        schemas.CategoryReport(name=row[0], value=row[1]) 
        for row in top_cats_query
    ]
    
    return schemas.ReportSummary(
        total_revenues=total_in,
        total_expenses=total_out,
        average_savings=avg_saving,
        monthly_comparative=dash.monthly_flow,
        top_categories=top_categories
    )
