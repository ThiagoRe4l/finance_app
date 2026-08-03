from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
import datetime
from typing import List

from app.database import get_db
from app import models, schemas
from app.routers.dashboard import get_dashboard_summary

router = APIRouter(
    prefix="/reports",
    tags=["Reports"]
)

@router.get("/overview", response_model=schemas.ReportSummary)
def get_report_overview(db: Session = Depends(get_db)):
    # 1. Reutiliza parte da lógica do dashboard para pegar o fluxo mensal
    dash = get_dashboard_summary(db)
    
    # 2. Calcula receitas totais e despesas totais dos últimos 6 meses
    total_in = sum(f.income for f in dash.monthly_flow)
    total_out = sum(f.outcome for f in dash.monthly_flow)
    avg_saving = (total_in - total_out) / len(dash.monthly_flow) if dash.monthly_flow else 0.0
    
    # 3. Maiores categorias (top categories)
    # Agrupa por categoria e soma valores
    top_cats_query = db.query(
        models.Transaction.category, 
        func.sum(models.Transaction.amount).label("total")
    ).filter(
        models.Transaction.type == "SAÍDA"
    ).group_by(
        models.Transaction.category
    ).order_by(
        func.sum(models.Transaction.amount).desc()
    ).limit(4).all()
    
    top_categories = [
        schemas.CategoryReport(name=row[0], value=row[1]) 
        for row in top_cats_query
    ]
    
    # 4. Insights (Mockados para o protótipo, mas baseados em dados reais se possível)
    insights = [
        f"Sua economia média mensal é de R$ {avg_saving:,.2f}.",
        "Despesas com Moradia representam a maior fatia do seu orçamento." if any(c.name == "Moradia" for c in top_categories) else "Mantenha o foco em reduzir gastos variáveis.",
        f"Você possui {dash.active_installments_count} parcelamentos ativos."
    ]
    
    return schemas.ReportSummary(
        total_revenues=total_in,
        total_expenses=total_out,
        average_savings=avg_saving,
        monthly_comparative=dash.monthly_flow,
        top_categories=top_categories,
        insights=insights
    )
