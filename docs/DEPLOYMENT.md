# 🚀 Free Deployment Guide — Advanced Finance Tracker

## Strategy: Separate Production vs Development Environments

### Overview
- **Development**: Local machine with a LOCAL database (Docker Compose)
- **Production**: Free cloud hosting with a SEPARATE production database
- **Key Rule**: Never point local dev to production DB. They are 100% isolated.

## Free Deployment Stack

| Component | Service | Free Tier |
|-----------|---------|-----------|
| Backend (FastAPI) | Render.com | 750 hrs/month free |
| Frontend (React) | Vercel or Netlify | Unlimited static hosting |
| Database (PostgreSQL) | Supabase or Neon.tech | 500MB free forever |

---

## Step 1 — Set Up Production Database (Supabase — Recommended)

1. Go to https://supabase.com → Sign up with GitHub
2. Create a new project → choose a region close to you (e.g., Asia South)
3. In Settings → Database → copy the **Connection string (URI)**
   - Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres`
4. Keep this URI safe — this is your production DATABASE_URL

**Why Supabase?**
- Free forever (500MB, no credit card)
- Daily backups on free tier
- Point-in-time recovery available
- Data never expires

---

## Step 2 — Deploy Backend to Render.com

1. Go to https://render.com → Sign up with GitHub
2. Click "New" → "Web Service"
3. Connect your GitHub repo: `amsxna060/Advanced_Finance_Tracker`
4. Configure:
   - **Root directory**: `backend`
   - **Runtime**: Python 3.11
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add Environment Variables:
   ```
   DATABASE_URL = postgresql://... (from Supabase)
   SECRET_KEY   = (generate: python -c "import secrets; print(secrets.token_hex(32))")
   ALLOWED_ORIGINS = https://your-frontend.vercel.app
   ENVIRONMENT = production
   ```
6. Click "Create Web Service"
7. Wait for first deploy (~3 mins)
8. Copy the Render URL: `https://advanced-finance-tracker.onrender.com`

**Note**: Free Render tier sleeps after 15 min of inactivity. First request after sleep takes ~30s to wake up. This is normal for free tier.

---

## Step 3 — Deploy Frontend to Vercel

1. Go to https://vercel.com → Sign up with GitHub
2. Click "Add New" → "Project" → Import `amsxna060/Advanced_Finance_Tracker`
3. Configure:
   - **Root directory**: `frontend`
   - **Framework**: Vite
   - **Build command**: `npm run build`
   - **Output directory**: `dist`
4. Add Environment Variable:
   ```
   VITE_API_URL = https://advanced-finance-tracker.onrender.com
   ```
5. Click "Deploy"
6. Your app is live at `https://advanced-finance-tracker.vercel.app`

---

## Step 4 — Run Database Migrations on Production

After first deploy, run migrations once:

```bash
# Connect to production DB and run Alembic migrations
# Option A: Via Render Shell (in Render dashboard → Shell tab)
alembic upgrade head

# Option B: Temporarily set DATABASE_URL locally and run
DATABASE_URL="postgresql://..." alembic upgrade head
```

---

## Development vs Production Isolation

### Local `.env` (development — never committed to git):
```
DATABASE_URL=postgresql://financeuser:financepass@localhost:5432/financedb
SECRET_KEY=dev-secret-key-not-for-production
ENVIRONMENT=development
```

### Production env vars (set in Render dashboard only):
```
DATABASE_URL=postgresql://postgres:[PROD_PASS]@db.[SUPABASE].supabase.co:5432/postgres
SECRET_KEY=[STRONG_RANDOM_KEY]
ENVIRONMENT=production
```

### Critical Rules:
1. ✅ Local dev uses local Docker PostgreSQL
2. ✅ Production uses Supabase PostgreSQL
3. ❌ NEVER copy production DATABASE_URL into local `.env`
4. ❌ NEVER run `alembic downgrade` on production
5. ✅ Always test migrations locally before deploying

---

## Data Safety Checklist

- [ ] Supabase automatic daily backups enabled (Settings → Backups)
- [ ] Strong SECRET_KEY set in Render (not shared)
- [ ] `.env` file in `.gitignore` (already done)
- [ ] Production DB password is different from dev password
- [ ] Supabase Row Level Security enabled for extra safety (optional)

---

## Database Backup (Manual)

```bash
# Export production data (run on your local machine)
pg_dump "postgresql://postgres:[PROD_PASS]@db.[SUPABASE].supabase.co:5432/postgres" \
  --format=custom \
  --file=backup_$(date +%Y%m%d).dump

# Restore if needed
pg_restore --clean --dbname="[TARGET_DB_URL]" backup_20260323.dump
```

---

## Cost Summary

| Service | Cost |
|---------|------|
| Render (backend) | FREE (750 hrs/month) |
| Vercel (frontend) | FREE (unlimited) |
| Supabase (database) | FREE forever (500MB) |
| **Total** | **₹0/month** |

## Alternative Free Options

- **Railway.app**: Free $5 credit/month (backend + DB both on Railway)
- **Fly.io**: Free tier available for small apps
- **PlanetScale**: Free MySQL (if you switch from PostgreSQL)
- **Neon.tech**: Alternative to Supabase, PostgreSQL, free 0.5GB

---

## Quick Tips

1. **Render free tier sleeps**: Add a UptimeRobot.com monitor (free) to ping your backend every 5 minutes to keep it awake
2. **Custom domain**: Both Render and Vercel support custom domains for free
3. **HTTPS**: Automatic SSL on both Render and Vercel
4. **Environment variables**: Never hardcode secrets in code — always use env vars
