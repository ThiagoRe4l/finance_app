from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
import datetime
from decimal import Decimal
from typing import List

from app.database import get_db
from app import models, schemas
from app.routers.categories import list_categories
from app.periods import current_month_bounds, month_bounds
from app import installment_metrics

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
def get_dashboard_summary(db: Session = Depends(get_db)):
    # 1. Saldo Total
    total_balance = db.query(func.sum(models.Account.current_balance)).scalar() or ZERO
    
    # 2. Receitas e Despesas do mês atual
    #
    # Intervalo semiaberto, o mesmo do laço abaixo e o mesmo de
    # `_aggregated_rows`. Antes daqui só havia o piso (`>= first_day`), sem teto:
    # um lançamento datado no futuro — parcela agendada, boleto a vencer —
    # contava neste total e não contava na barra do mesmo mês do `monthly_flow`,
    # dois números divergentes lado a lado na tela.
    today = datetime.date.today()
    first_day, next_month = current_month_bounds()

    total_revenues = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.type == "ENTRADA",
        models.Transaction.date >= first_day,
        models.Transaction.date < next_month
    ).scalar() or ZERO
    
    total_expenses = db.query(func.sum(models.Transaction.amount)).filter(
        models.Transaction.type == "SAÍDA",
        models.Transaction.date >= first_day,
        models.Transaction.date < next_month
    ).scalar() or ZERO
    
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
            
        m_start, m_end = month_bounds(target_year, target_month)
            
        inc = db.query(func.sum(models.Transaction.amount)).filter(
            models.Transaction.type == "ENTRADA",
            models.Transaction.date >= m_start,
            models.Transaction.date < m_end
        ).scalar() or ZERO
        
        out = db.query(func.sum(models.Transaction.amount)).filter(
            models.Transaction.type == "SAÍDA",
            models.Transaction.date >= m_start,
            models.Transaction.date < m_end
        ).scalar() or ZERO
        
        monthly_flow.append(schemas.MonthlyFlow(
            month=month_names[target_month-1], 
            income=inc, 
            outcome=out
        ))
        
    # 3.1. Variações percentuais exibidas nos cards do dashboard
    previous_month = monthly_flow[-2]

    expenses_change_pct = None
    if previous_month.outcome:
        expenses_change_pct = float((total_expenses - previous_month.outcome) / previous_month.outcome * 100)

    # Saldo ao fim do mês anterior = saldo atual menos a movimentação líquida deste mês
    balance_prev_month_end = total_balance - total_savings
    balance_change_pct = None
    if balance_prev_month_end:
        # abs() no denominador: com saldo anterior negativo, a divisão direta inverteria
        # o sinal e uma economia positiva apareceria como variação negativa.
        balance_change_pct = float(total_savings / abs(balance_prev_month_end) * 100)

    savings_pct_of_revenue = None
    if total_revenues:
        savings_pct_of_revenue = float(total_savings / total_revenues * 100)

    # 4. Transações Recentes
    recent_txs = db.query(models.Transaction).options(
        joinedload(models.Transaction.installment),
        joinedload(models.Transaction.category)
    ).order_by(models.Transaction.date.desc(), models.Transaction.id.desc()).limit(7).all()
    
    # 5. Distribuição de Categorias
    categories_dist = list_categories(db)
    
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
        balance_change_pct=balance_change_pct,
        expenses_change_pct=expenses_change_pct,
        savings_pct_of_revenue=savings_pct_of_revenue
    )
