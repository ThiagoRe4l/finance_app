from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
import datetime
from typing import List

from app.database import get_db
from app import models, schemas
from app.routers.categories import list_categories

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"]
)

@router.get("/summary", response_model=schemas.DashboardSummary)
def get_dashboard_summary(db: Session = Depends(get_db)):
    # 1. Saldo Total
    total_balance = db.query(func.sum(models.Account.current_balance)).scalar() or 0.0
    
    # 2. Receitas e Despesas do mês atual
    today = datetime.date.today()
    first_day = today.replace(day=1)
    
    total_revenues = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.type == "ENTRADA",
        models.Transaction.date >= first_day
    ).scalar() or 0.0
    
    total_expenses = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.type == "SAÍDA",
        models.Transaction.date >= first_day
    ).scalar() or 0.0
    
    total_savings = total_revenues - total_expenses
    
    # 3. Fluxo Mensal (últimos 6 meses)
    monthly_flow = []
    # Usaremos uma lista fixa de nomes de meses para simplificar o pareamento com o front
    month_names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    
    for i in range(5, -1, -1):
        # Cálculo aproximado dos últimos 6 meses
        target_month = today.month - i
        target_year = today.year
        if target_month <= 0:
            target_month += 12
            target_year -= 1
            
        m_start = datetime.date(target_year, target_month, 1)
        if target_month == 12:
            m_end = datetime.date(target_year + 1, 1, 1)
        else:
            m_end = datetime.date(target_year, target_month + 1, 1)
            
        inc = db.query(func.sum(models.Transaction.amount)).filter(
            models.Transaction.type == "ENTRADA",
            models.Transaction.date >= m_start,
            models.Transaction.date < m_end
        ).scalar() or 0.0
        
        out = db.query(func.sum(models.Transaction.amount)).filter(
            models.Transaction.type == "SAÍDA",
            models.Transaction.date >= m_start,
            models.Transaction.date < m_end
        ).scalar() or 0.0
        
        monthly_flow.append(schemas.MonthlyFlow(
            month=month_names[target_month-1], 
            income=inc, 
            outcome=out
        ))
        
    # 4. Transações Recentes
    recent_txs = db.query(models.Transaction).order_by(models.Transaction.date.desc(), models.Transaction.id.desc()).limit(7).all()
    
    # 5. Distribuição de Categorias
    categories_dist = list_categories(db)
    
    # 6. Parcelamentos
    installments = db.query(models.Installment).all()
    committed = sum(it.installment_amount for it in installments)
    
    return schemas.DashboardSummary(
        total_balance=total_balance,
        total_revenues=total_revenues,
        total_expenses=total_expenses,
        total_savings=total_savings,
        monthly_flow=monthly_flow,
        recent_transactions=recent_txs,
        category_distribution=categories_dist,
        active_installments_count=len(installments),
        monthly_committed_amount=committed
    )
