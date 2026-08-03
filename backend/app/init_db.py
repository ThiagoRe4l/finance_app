from app.database import engine, Base, SessionLocal
# Importamos todos os modelos para garantir que são registrados na Base.metadata
from app.models import Account, Transaction, Investment, InvestmentHistory, Category, Installment

def init_database():
    print("Criando tabelas no banco de dados SQLite...")
    Base.metadata.create_all(bind=engine)
    print("Banco de dados inicializado com sucesso!")
    seed_data()

def seed_data():
    db = SessionLocal()
    try:
        # 1. Cria Conta Padrão se não existir
        if not db.query(Account).first():
            main_account = Account(name="Conta Principal", initial_balance=10000.0, current_balance=10000.0)
            db.add(main_account)
            print("Conta padrão criada.")
        
        # 2. Cria Categorias Padrão se não existirem
        if not db.query(Category).first():
            categories = [
                {"name": "Moradia", "icon_name": "Home", "budget": 2500, "color": "oklch(0.45 0.04 235)"},
                {"name": "Alimentação", "icon_name": "UtensilsCrossed", "budget": 1500, "color": "oklch(0.6 0.15 155)"},
                {"name": "Transporte", "icon_name": "Car", "budget": 600, "color": "oklch(0.65 0.18 50)"},
                {"name": "Lazer", "icon_name": "Gamepad2", "budget": 400, "color": "oklch(0.6 0.2 300)"},
                {"name": "Saúde", "icon_name": "HeartPulse", "budget": 300, "color": "oklch(0.6 0.2 25)"},
                {"name": "Educação", "icon_name": "GraduationCap", "budget": 250, "color": "oklch(0.55 0.15 200)"},
                {"name": "Compras", "icon_name": "ShoppingBag", "budget": 200, "color": "oklch(0.55 0.05 250)"},
                {"name": "Receita", "icon_name": "Plus", "budget": 0, "color": "oklch(0.94 0.06 155)"},
            ]
            for cat in categories:
                db.add(Category(**cat))
            print("Categorias padrão criadas.")
            
        db.commit()
    except Exception as e:
        print(f"Erro ao popular dados iniciais: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_database()
