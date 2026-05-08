# Oracle Cloud Deployment Guide
### Finance Tracker — Backend + PostgreSQL (Always Free, Forever)

> **What we're building:** FastAPI backend on an Oracle ARM VM + self-hosted PostgreSQL,
> behind Nginx with SSL. Daily automated DB backups. GitHub Actions CI/CD.
> All on Oracle Always Free — no credit card charges, no 12-month expiry.

---

## Oracle Always Free vs AWS Free Tier (Quick Comparison)

| | Oracle Always Free | AWS Free Tier |
|---|---|---|
| Compute | 4 ARM cores + 24 GB RAM | t2.micro (1 core, 1 GB RAM) |
| Duration | **Forever** | 12 months only |
| Database | Self-hosted PostgreSQL on VM | RDS free tier = 12 months only |
| Storage | 200 GB block storage | 30 GB EBS |
| Bandwidth | 10 TB/month outbound | 1 GB/month |
| Cost after free period | Still free | Billing starts |

**ARM vs x86:** Oracle's free VM uses ARM (Apple M-chip architecture family). All the software below (Python, PostgreSQL, Nginx) works perfectly on ARM/Ubuntu.

---

## What You've Done So Far ✅

- Created Oracle Cloud account
- Created VCN `finance-tracker-vcn` with CIDR `10.0.0.0/16`
- Created public subnet `10.0.0.0/24`
- Security List has SSH (22), HTTP (80), HTTPS (443) open

---

## Part 1 — Create the VM (Compute Instance)

### Step 1.1 — Launch Instance

1. Go to **Compute → Instances → Create Instance**
2. Fill in:
   - **Name:** `finance-tracker-vm`
   - **Compartment:** `amolsaxena060 (root)`

### Step 1.2 — Choose Image and Shape

3. Under **Image and Shape**, click **Edit**
4. **Image:** Click "Change Image" → select **Ubuntu** → pick **Ubuntu 22.04** (not 24.04 — better package support)
5. **Shape:** Click "Change Shape"
   - Select **Ampere** tab (ARM)
   - Select **VM.Standard.A1.Flex**
   - Set **OCPUs: 2**, **Memory: 12 GB** (you can use up to 4 OCPUs + 24 GB total for free)
6. Click **Select Shape**

### Step 1.3 — Networking

7. Under **Networking**, verify:
   - VCN: `finance-tracker-vcn`
   - Subnet: `public-subnet`
   - **Assign a public IPv4 address: YES** ← important

### Step 1.4 — SSH Key

8. Under **Add SSH keys**, select **Generate a key pair for me**
9. Click **Save Private Key** → it downloads `ssh-key-YYYY-MM-DD.key`
10. Move it somewhere safe:
    ```bash
    # On your Mac terminal:
    mv ~/Downloads/ssh-key-*.key ~/.ssh/oracle-finance.key
    chmod 400 ~/.ssh/oracle-finance.key
    ```

### Step 1.5 — Boot Volume

11. Under **Boot Volume**, set size to **50 GB** (free allowance is 200 GB total)

12. Click **Create** — wait ~2 minutes for status to become **Running**

13. Copy the **Public IP address** from the instance details page. You'll use it everywhere.

---

## Part 2 — Connect to Your VM

```bash
# From your Mac terminal:
ssh -i ~/.ssh/oracle-finance.key ubuntu@<YOUR_PUBLIC_IP>
```

First time: type `yes` when asked about fingerprint.

You're now inside your Oracle VM. Think of it as a remote computer you control via terminal.

> **AWS equivalent:** Same as SSH-ing into an EC2 instance with a `.pem` key.

---

## Part 3 — Install Everything on the VM

Run all of the following while SSH'd into the VM.

### Step 3.1 — System Updates

```bash
sudo apt update && sudo apt upgrade -y
```

### Step 3.2 — Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql   # auto-start on reboot
```

Verify it's running:
```bash
sudo systemctl status postgresql
```

### Step 3.3 — Create Database and User

```bash
sudo -u postgres psql
```

Inside the PostgreSQL prompt:
```sql
CREATE USER financeapp WITH PASSWORD 'root';
CREATE DATABASE finance_tracker OWNER financeapp;
GRANT ALL PRIVILEGES ON DATABASE finance_tracker TO financeapp;
\q
```

Test the connection:
```bash
psql -U financeapp -d finance_tracker -h localhost
# Enter password, then \q to exit
```

### Step 3.4 — Install Python and Dependencies

```bash
sudo apt install -y python3 python3-pip python3-venv git nginx certbot python3-certbot-nginx
```

Verify Python version (should be 3.10+):
```bash
python3 --version
```

### Step 3.5 — Clone Your Repository

```bash
cd /home/ubuntu
git clone https://github.com/YOUR_GITHUB_USERNAME/Advanced_Finance_Tracker.git
cd Advanced_Finance_Tracker
```

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

### Step 3.6 — Set Up Python Virtual Environment

```bash
cd /home/ubuntu/Advanced_Finance_Tracker/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 3.7 — Create Environment File

```bash
nano /home/ubuntu/Advanced_Finance_Tracker/backend/.env
```

Paste this (fill in your actual values):
```env
# ─── Database ─────────────────────────────────────────────────
DATABASE_URL=postgresql://financeapp:root@localhost:5432/finance_tracker

# ─── JWT ────────────────────────────────────────────────────
SECRET_KEY=edde8f133289d4c1c6053b9e66a4119daabff95c53bcfb6e2871068e93c0cda0
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

GEMINI_API_KEY=AIzaSyCU6KyFVNe0gk3hvgOGtVcgykebFbTJnoU

# ─── App ────────────────────────────────────────────────────
APP_ENV=production
CORS_ORIGINS=http://localhost:5173

# ─── Gold Price API ─────────────────────────────────────────
GOLD_API_URL=https://goldpricez.com/api/rates/currency/inr/measure/gram
GOLD_CACHE_TTL_SECONDS=3600

# ─── Seed Admin (created on first startup if no users exist) ─
SEED_ADMIN_USERNAME=amolsaxena060
SEED_ADMIN_PASSWORD=8268Gupt@
SEED_ADMIN_EMAIL=amolsaxena060@gmail.com
```

Generate a SECRET_KEY:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Press `Ctrl+X`, then `Y`, then `Enter` to save.

### Step 3.8 — Run Database Migrations

```bash
cd /home/ubuntu/Advanced_Finance_Tracker/backend
source venv/bin/activate
alembic upgrade head
```

This runs all your migration files including the new `035_soft_delete_transactions.py`.

---

## Part 4 — Run the App as a System Service (systemd)

systemd = Oracle's equivalent of Render's "always on." It keeps your app running 24/7 and restarts it if it crashes.

> **AWS equivalent:** Like running your app with `pm2` on an EC2 instance, or using ECS.

### Step 4.1 — Create the Service File

```bash
sudo nano /etc/systemd/system/finance-tracker.service
```

Paste exactly:
```ini
[Unit]
Description=Finance Tracker FastAPI Backend
After=network.target postgresql.service

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Advanced_Finance_Tracker/backend
Environment="PATH=/home/ubuntu/Advanced_Finance_Tracker/backend/venv/bin"
EnvironmentFile=/home/ubuntu/Advanced_Finance_Tracker/backend/.env
ExecStart=/home/ubuntu/Advanced_Finance_Tracker/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Save with `Ctrl+X`, `Y`, `Enter`.

### Step 4.2 — Start and Enable the Service

```bash
sudo systemctl daemon-reload
sudo systemctl start finance-tracker
sudo systemctl enable finance-tracker   # auto-start on reboot
sudo systemctl status finance-tracker
```

You should see `Active: active (running)`.

Test it works:
```bash
curl http://localhost:8000/health
```

---

## Part 5 — Set Up Nginx (Reverse Proxy)

Nginx sits in front of your app. It handles HTTPS, forwards requests to your FastAPI on port 8000.

> **AWS equivalent:** Like an Application Load Balancer in front of your EC2 instance.

### Step 5.1 — Create Nginx Config

```bash
sudo nano /etc/nginx/sites-available/finance-tracker
```

Paste (replace `YOUR_DOMAIN_OR_IP` with your actual domain or public IP):
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
    }
}
```

### Step 5.2 — Enable the Site

```bash
sudo ln -s /etc/nginx/sites-available/finance-tracker /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default   # remove default placeholder
sudo nginx -t                               # test config — must say "ok"
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## Part 6 — Free SSL Certificate (HTTPS)

**Only do this if you have a domain name pointing to your Oracle IP.**

If you're using raw IP for now, skip to Part 7 and come back here after getting a domain.

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

- Enter your email
- Agree to terms
- Choose to redirect HTTP → HTTPS (option 2)

Certbot auto-renews every 90 days. Verify the timer:
```bash
sudo systemctl status certbot.timer
```

---

## Part 7 — Migrate Database from Supabase to Oracle

### Step 7.1 — Export from Supabase (Run on Your Mac)

Get your Supabase connection string from: Supabase Dashboard → Settings → Database → Connection string (URI format).

It looks like:
```
postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

Run the dump on your Mac:
```bash
pg_dump \
  "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  --no-owner \
  --no-acl \
  --format=custom \
  --file=supabase_backup.dump
```

If you don't have `pg_dump` on Mac:
```bash
brew install postgresql
```

### Step 7.2 — Copy Dump to Oracle VM

```bash
scp -i ~/.ssh/oracle-finance.key supabase_backup.dump ubuntu@<YOUR_PUBLIC_IP>:/home/ubuntu/
```

### Step 7.3 — Restore on Oracle (Run on Oracle VM)

```bash
pg_restore \
  --host=localhost \
  --username=financeapp \
  --dbname=finance_tracker \
  --no-owner \
  --no-acl \
  --verbose \
  /home/ubuntu/supabase_backup.dump
```

Enter the password when prompted.

Verify the data:
```bash
psql -U financeapp -d finance_tracker -h localhost -c "\dt"
# Shows all your tables
psql -U financeapp -d finance_tracker -h localhost -c "SELECT COUNT(*) FROM users;"
```

### Step 7.4 — Update Your Frontend

In your frontend `.env` or config, update the API URL from the Render URL to:
```
https://yourdomain.com
```
or if using raw IP:
```
http://<YOUR_PUBLIC_IP>
```

---

## Part 8 — Automated Daily Database Backups

### Step 8.1 — Create Backup Script

```bash
sudo mkdir -p /var/backups/finance-tracker
sudo chown ubuntu:ubuntu /var/backups/finance-tracker

nano /home/ubuntu/backup-db.sh
```

Paste:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/finance-tracker"
DATE=$(date +%Y-%m-%d_%H-%M)
FILENAME="$BACKUP_DIR/finance_tracker_$DATE.dump"

# Create backup
PGPASSWORD="choose_a_strong_password_here" pg_dump \
  -U financeapp \
  -h localhost \
  -F custom \
  -f "$FILENAME" \
  finance_tracker

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "*.dump" -mtime +30 -delete

echo "Backup completed: $FILENAME"
```

Make it executable:
```bash
chmod +x /home/ubuntu/backup-db.sh
```

Test it works:
```bash
/home/ubuntu/backup-db.sh
ls /var/backups/finance-tracker/
```

### Step 8.2 — Schedule with Cron (Daily at 2 AM)

```bash
crontab -e
```

Select nano (option 1) if prompted. Add this line at the bottom:
```
0 2 * * * /home/ubuntu/backup-db.sh >> /var/log/finance-backup.log 2>&1
```

Save and exit. Verify:
```bash
crontab -l
```

> **AWS equivalent:** Like an EventBridge scheduled rule triggering a Lambda to run pg_dump.

---

## Part 9 — GitHub Actions CI/CD Pipeline

Every time you push to `main`, this automatically deploys to your Oracle VM.

### Step 9.1 — Add Secrets to GitHub

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:
| Name | Value |
|------|-------|
| `ORACLE_HOST` | Your Oracle VM public IP |
| `ORACLE_USER` | `ubuntu` |
| `ORACLE_SSH_KEY` | Contents of your `~/.ssh/oracle-finance.key` file |

To get the key contents:
```bash
cat ~/.ssh/oracle-finance.key
```
Copy everything including `-----BEGIN...` and `-----END...` lines.

### Step 9.2 — Create the Workflow File

On your Mac, in your project:
```bash
mkdir -p .github/workflows
```

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Oracle Cloud

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Deploy to Oracle VM
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.ORACLE_HOST }}
          username: ${{ secrets.ORACLE_USER }}
          key: ${{ secrets.ORACLE_SSH_KEY }}
          script: |
            cd /home/ubuntu/Advanced_Finance_Tracker
            git pull origin main
            source backend/venv/bin/activate
            pip install -r backend/requirements.txt --quiet
            cd backend
            alembic upgrade head
            sudo systemctl restart finance-tracker
            echo "Deploy complete: $(date)"
```

Commit and push:
```bash
git add .github/workflows/deploy.yml
git commit -m "Add Oracle Cloud CI/CD pipeline"
git push origin main
```

Go to GitHub → **Actions** tab to watch the deployment run.

> **AWS equivalent:** Like CodeDeploy or a GitHub Action deploying to EC2 via SSH.

---

## Part 10 — Update Frontend to Point to Oracle

In your frontend config/`.env`:
```env
VITE_API_BASE_URL=https://yourdomain.com
```
or with raw IP:
```env
VITE_API_BASE_URL=http://<YOUR_PUBLIC_IP>
```

Redeploy frontend to Vercel (or wherever it's hosted) — just push to main if auto-deploy is set up.

---

## Maintenance Cheatsheet

```bash
# SSH into VM
ssh -i ~/.ssh/oracle-finance.key ubuntu@<YOUR_PUBLIC_IP>

# View app logs (live)
sudo journalctl -u finance-tracker -f

# Restart app
sudo systemctl restart finance-tracker

# App status
sudo systemctl status finance-tracker

# View last 100 log lines
sudo journalctl -u finance-tracker -n 100

# Manual DB backup right now
/home/ubuntu/backup-db.sh

# List backups
ls -lh /var/backups/finance-tracker/

# Restore a backup (if needed)
pg_restore --host=localhost --username=financeapp --dbname=finance_tracker --clean /var/backups/finance-tracker/finance_tracker_YYYY-MM-DD_HH-MM.dump

# Check PostgreSQL status
sudo systemctl status postgresql

# Connect to DB directly
psql -U financeapp -d finance_tracker -h localhost

# Check Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Renew SSL certificate manually
sudo certbot renew
```

---

## Architecture Overview

```
Internet
    │
    ▼
Oracle VM (Public IP)
    │
    ▼
Nginx (port 80/443)  ← handles SSL, reverse proxy
    │
    ▼
FastAPI / Uvicorn (port 8000, internal only)
    │
    ▼
PostgreSQL (port 5432, localhost only)
    │
    ▼
/var/backups/  ← daily pg_dump, 30-day retention
```

---

## Troubleshooting

**App won't start:**
```bash
sudo journalctl -u finance-tracker -n 50 --no-pager
```

**502 Bad Gateway from Nginx:**
```bash
# App isn't running — check:
sudo systemctl status finance-tracker
curl http://localhost:8000/health
```

**Can't connect via SSH:**
- Check Security List has port 22 open from `0.0.0.0/0`
- Check your IP didn't change (use `0.0.0.0/0` for simplicity on personal projects)

**Database connection refused:**
```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

**Migration failed:**
```bash
cd /home/ubuntu/Advanced_Finance_Tracker/backend
source venv/bin/activate
alembic current        # see current revision
alembic history        # see all migrations
alembic upgrade head   # run pending migrations
```

**Disk space check:**
```bash
df -h
du -sh /var/backups/finance-tracker/
```
