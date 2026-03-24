# 🏦 Advanced Finance Tracker

A full-stack personal finance management web application for tracking money lending, property deals, partnerships, and expenses.

## 🎉 Status: Phase 2 Complete! ✅

**Current Features (Working Now):**

- ✅ **Contacts Management**: Full CRUD with search, filtering, and financial summaries
- ✅ **Loans Management**: Track all 3 loan types (Interest Only, EMI, Short Term)
- ✅ **Payment Recording**: Real-time allocation preview before committing
- ✅ **Outstanding Calculation**: Day-level precision interest calculation
- ✅ **Collateral Tracking**: Gold rate API integration with auto-value calculation
- ✅ **Interest Capitalization**: Admin-only feature to add interest to principal
- ✅ **JWT Authentication**: Auto-refresh tokens with role-based access

**Coming Soon (Phase 3):**

- Property Deals & Transactions
- Partnerships & Joint Ventures
- Dashboard Analytics & Charts
- Expense Tracking

## 🚀 Quick Start

### Prerequisites

- Docker Desktop installed and running
- Git (optional)

### Start the Application

1. **Start Docker Desktop** (make sure it's running)

2. **Navigate to project directory:**

   ```bash
   cd /Users/amolsaxena/Downloads/Advanced_Finance_Tracker
   ```

3. **Start all services:**

   ```bash
   docker-compose up --build
   ```

   Wait for all services to start (you'll see "Application startup complete" in logs)

4. **Access the application:**
   - **Frontend:** http://localhost:5173 ← Start here!
   - **API Docs:** http://localhost:8000/docs
   - **Backend:** http://localhost:8000

5. **Default login credentials:**
   - Username: `admin`
   - Password: `admin123`

6. **Start using:**
   - Click "Contacts" to manage contacts
   - Click "Loans" to manage loans and record payments
   - View real-time outstanding balances
   - Record payments with allocation preview

### Stop the Application

```bash
docker-compose down
```

### Reset Database (start fresh)

```bash
docker-compose down -v
docker-compose up --build
```

## 📖 Documentation

- **QUICKSTART_PHASE2.md** - Quick user guide and troubleshooting
- **PHASE2_COMPLETE.md** - Complete feature list and technical details
- **MOMENTO.md** - Living knowledge base (update as you build)
- **PROMPT.md** - Original requirements and specifications

## 📁 Project Structure

```
Advanced_Finance_Tracker/
├── backend/           # FastAPI Python backend
│   ├── app/
│   │   ├── models/   # SQLAlchemy database models
│   │   ├── schemas/  # Pydantic request/response schemas
│   │   ├── routers/  # API endpoints
│   │   └── services/ # Business logic
│   ├── alembic/      # Database migrations
│   └── Dockerfile
│
├── frontend/         # React + Vite frontend
│   ├── src/
│   │   ├── pages/   # Page components
│   │   ├── contexts/ # React contexts (Auth)
│   │   └── lib/     # Utilities & API client
│   └── Dockerfile
│
└── docker-compose.yml
```

## 🛠️ Tech Stack

**Backend:**

- FastAPI (Python web framework)
- PostgreSQL (Database)
- SQLAlchemy (ORM)
- Alembic (Migrations)
- JWT Authentication

**Frontend:**

- React 18
- Vite (Build tool)
- TailwindCSS (Styling)
- TanStack Query (Server state)
- React Router (Routing)

## 📝 Current Status

✅ **Completed:**

- Project structure setup
- Docker configuration
- Database models (all tables)
- Authentication system (JWT)
- Login page
- Basic dashboard

🚧 **In Progress:**

- API endpoints for Contacts, Loans, Properties, etc.
- Frontend pages for all modules
- Dashboard with charts and summaries

## 📖 Documentation

- See `PROMPT.md` for complete technical specification
- See `MOMENTO.md` for development progress and decisions

## 🔧 Development

### Database Migrations

**Migrations are applied automatically** when the backend container starts, so you don't need to run them manually in most cases.

#### Manual Migration Commands (if needed)

```bash
# Run migrations manually
docker-compose exec backend alembic upgrade head

# Check current migration version
docker-compose exec backend alembic current

# View migration history
docker-compose exec backend alembic history
```

### Create new migration

```bash
# Generate a new migration based on model changes
docker-compose exec backend alembic revision --autogenerate -m "description"

# After creating the migration, restart the backend to apply it
docker-compose restart backend
```

### View logs

```bash
docker-compose logs -f backend    # Backend logs
docker-compose logs -f frontend   # Frontend logs
docker-compose logs -f postgres   # Database logs
```

## 🚀 Deployment Process

When you commit and deploy this code:

1. **Automatic Migration Execution**:
   - The backend container runs `alembic upgrade head` automatically on startup
   - This applies any pending database migrations before the server starts
   - See `backend/start.sh` for the startup script

2. **Deployment Steps**:

   ```bash
   # 1. Commit your changes
   git add .
   git commit -m "Your commit message"

   # 2. Rebuild and restart containers
   docker-compose down
   docker-compose up --build

   # The backend will automatically run migrations during startup
   ```

3. **Production Deployment**:
   - Ensure your production environment variables are set (especially `DATABASE_URL` and `SECRET_KEY`)
   - Migrations will run automatically when containers start
   - Monitor logs to verify successful migration: `docker-compose logs backend`

## 🐛 Troubleshooting

**Docker not starting:**

- Ensure Docker Desktop is running
- Check if ports 5432, 8000, 5173 are available

**Cannot connect to database:**

- Wait 10-15 seconds after `docker-compose up` for DB to be ready
- Check logs: `docker-compose logs postgres`

**Frontend not loading:**

- Check backend is running: http://localhost:8000/health
- Check console for CORS errors

## 📄 License

Private project - All rights reserved
