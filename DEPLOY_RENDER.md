# Deployment Guide for Render.com

This guide will help you deploy the Advanced Finance Tracker to Render.com's free tier.

## Prerequisites

- GitHub account with this repository pushed
- Render.com account (free tier is sufficient)

## Step-by-Step Deployment

### 1. Create PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New** → **PostgreSQL**
3. Configure:
   - **Name**: `finance-tracker-db`
   - **Database**: `finance_tracker`
   - **User**: `admin` (or your choice)
   - **Region**: Choose closest to you
   - **Plan**: Free
4. Click **Create Database**
5. **Important**: Copy the **Internal Database URL** (starts with `postgresql://`) - you'll need this!

### 2. Deploy Backend API

1. Go to Render Dashboard
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `finance-tracker-backend`
   - **Region**: Same as your database
   - **Branch**: `main`
   - **Root Directory**: Leave blank (or use `backend` if Render supports it)
   - **Environment**: `Docker`
   - **Dockerfile Path**: `backend/Dockerfile`
   - **Docker Context**: `backend`
   - **Plan**: Free

5. **Environment Variables** (Click "Advanced" → "Add Environment Variable"):

   ```
   DATABASE_URL = <paste your Internal Database URL from step 1>
   SECRET_KEY = <generate a random string, e.g., openssl rand -hex 32>
   ALGORITHM = HS256
   ACCESS_TOKEN_EXPIRE_MINUTES = 15
   REFRESH_TOKEN_EXPIRE_DAYS = 7
   CORS_ORIGINS = https://your-frontend-app.onrender.com
   GOLD_API_URL = https://goldpricez.com/api/rates/currency/inr/measure/gram
   GOLD_CACHE_TTL_SECONDS = 3600
   SEED_ADMIN_USERNAME = admin
   SEED_ADMIN_PASSWORD = admin123
   SEED_ADMIN_EMAIL = admin@finance.local
   ```

   **Note**: You'll update `CORS_ORIGINS` after deploying the frontend

6. Click **Create Web Service**

7. **Wait for deployment** - Render will:
   - Build your Docker image
   - Run database migrations automatically (via `prestart.py`)
   - Start the FastAPI server

8. **Verify deployment**:
   - Go to `https://your-backend-app.onrender.com/docs`
   - You should see the Swagger API documentation

### 3. Deploy Frontend

1. Go to Render Dashboard
2. Click **New** → **Static Site**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `finance-tracker-frontend`
   - **Branch**: `main`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`

5. **Environment Variables**:

   ```
   VITE_API_URL = https://your-backend-app.onrender.com
   ```

6. Click **Create Static Site**

7. **Wait for deployment**

### 4. Update CORS Configuration

1. Go back to your backend service in Render
2. Update the `CORS_ORIGINS` environment variable with your frontend URL:
   ```
   CORS_ORIGINS = https://your-frontend-app.onrender.com
   ```
3. Click **Save Changes** - this will trigger a redeploy

### 5. Test Your Application

1. Visit your frontend URL: `https://your-frontend-app.onrender.com`
2. Login with default credentials:
   - Username: `admin`
   - Password: `admin123`
3. Create contacts, loans, properties, etc.

## Troubleshooting

### Issue: Database migrations not running

**Symptoms**:

- 500 errors when accessing API
- Dashboard shows 0.00 for all values
- Errors about missing columns

**Solution**:
The `prestart.py` script runs migrations automatically. Check the deployment logs:

1. Go to your backend service in Render
2. Click **Logs** tab
3. Look for lines showing:
   ```
   Running database migrations...
   INFO  [alembic.runtime.migration] Running upgrade...
   Database migrations completed successfully!
   ```

If migrations didn't run:

1. Check that `prestart.py` exists in your repository
2. Verify the Dockerfile CMD is: `["sh", "-c", "python prestart.py && uvicorn app.main:app --host 0.0.0.0 --port 8000"]`
3. Manually trigger a redeploy

### Issue: CORS errors in browser console

**Symptoms**:

- Frontend shows errors like "blocked by CORS policy"
- API requests fail with network errors

**Solution**:

1. Check that `CORS_ORIGINS` in backend includes your frontend URL
2. Make sure there's no trailing slash in the URL
3. Redeploy backend after changing CORS_ORIGINS

### Issue: Free tier goes to sleep

**Symptoms**:

- First request takes 30+ seconds
- Subsequent requests are fast

**Explanation**:
Render's free tier services sleep after 15 minutes of inactivity. This is normal behavior.

**Solutions**:

1. Upgrade to paid tier ($7/month) for always-on services
2. Use an uptime monitoring service (like UptimeRobot) to ping your backend every 10 minutes
3. Accept the occasional slow first load

### Issue: Database connection errors

**Symptoms**:

- Errors mentioning "could not connect to database"
- 500 errors on all API endpoints

**Solution**:

1. Verify `DATABASE_URL` is set correctly in environment variables
2. Make sure you're using the **Internal Database URL**, not the external one
3. Check that your database service is running (not suspended)

### Issue: Build failures

**Symptoms**:

- Deployment fails during build phase

**Solution**:

1. Check the build logs for specific error messages
2. Verify `requirements.txt` (backend) and `package.json` (frontend) are correct
3. Make sure Dockerfile paths are correct
4. Try clearing cache and redeploying

## Monitoring and Maintenance

### View Logs

- **Backend**: Dashboard → Your service → Logs tab
- **Database**: Dashboard → Your database → Logs tab

### Restart Services

If something goes wrong:

1. Dashboard → Your service → Settings
2. Scroll down → Manual Deploy → Deploy latest commit

### Update Environment Variables

1. Dashboard → Your service → Environment
2. Add/Update variables
3. Save Changes (this triggers automatic redeploy)

## Database Migrations

Migrations run automatically on every deployment via `prestart.py`.

To create new migrations locally:

```bash
# In backend directory
docker-compose exec backend alembic revision --autogenerate -m "description"

# Commit the new migration file
git add backend/alembic/versions/
git commit -m "Add new migration"
git push

# Render will automatically run it on next deploy
```

## Performance Tips

1. **Enable connection pooling**: Already configured in the app
2. **Use database indexes**: Already set up in models
3. **Monitor query performance**: Use Render's metrics dashboard
4. **Optimize frontend build**: Run `npm run build` locally first to check for issues

## Security Checklist

- [ ] Change `SEED_ADMIN_PASSWORD` after first login
- [ ] Use a strong `SECRET_KEY` (generate with `openssl rand -hex 32`)
- [ ] Set `CORS_ORIGINS` to only your frontend domain
- [ ] Enable Render's SSL (automatic on all plans)
- [ ] Regularly update dependencies

## Cost Optimization

Free tier includes:

- 750 hours/month for web services (enough for 1 backend)
- 1GB PostgreSQL database
- 100GB bandwidth

To stay within free tier:

- Use only one backend and frontend
- Monitor database size
- Compress images and assets

## Support

If you need help:

1. Check Render's [documentation](https://render.com/docs)
2. Review deployment logs carefully
3. Search Render's community forum
4. Check this project's GitHub issues

## Updating Deployed Application

```bash
# Make changes locally
git add .
git commit -m "Your changes"
git push origin main

# Render will automatically:
# 1. Detect the push
# 2. Rebuild and redeploy
# 3. Run migrations
# 4. Restart services
```
