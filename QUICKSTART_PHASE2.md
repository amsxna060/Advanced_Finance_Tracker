# 🚀 Quick Start Guide - Phase 2 Complete

## ✅ System Status: READY FOR USE

All services are running and Phase 2 (Core Lending) is fully implemented!

---

## 🔗 Access Points

| Service      | URL                        | Credentials      |
| ------------ | -------------------------- | ---------------- |
| **Frontend** | http://localhost:5173      | admin / admin123 |
| **API Docs** | http://localhost:8000/docs | N/A (public)     |
| **Backend**  | http://localhost:8000      | N/A              |
| **Database** | localhost:5432             | admin / secret   |

---

## 📱 Quick User Guide

### 1. Login

- Go to http://localhost:5173
- Enter: `admin` / `admin123`
- Click "Login"

### 2. Navigate Dashboard

You'll see 4 cards:

- **Contacts** → Manage your contacts (WORKING ✅)
- **Loans** → Track lending activities (WORKING ✅)
- **Properties** → Coming in Phase 3 🔜
- **Partnerships** → Coming in Phase 3 🔜

### 3. Manage Contacts

**View Contacts:**

- Click "Contacts" card on dashboard
- Use search bar to find by name, phone, or city
- Use dropdown to filter by type (Borrower, Lender, Both)
- Click any contact card to see details

**Contact Details:**

- See phone, address, and notes
- View financial summary:
  - Total amount lent to this contact
  - Total amount borrowed from this contact
  - Number of active loans
- Quick actions available

### 4. Manage Loans

**View Loans:**

- Click "Loans" card on dashboard
- Filter by:
  - Direction (Given = lent out, Taken = borrowed)
  - Type (Interest Only, EMI, Short Term)
  - Status (Active, Closed)
  - Contact (dropdown list)
- Search by contact name or notes
- Click any row to see full details

**Loan Details:**

- **Outstanding Balance** (top card in blue):
  - Principal Outstanding
  - Interest Outstanding
  - Total Due (as of today)
- **Loan Information:**
  - All loan terms and dates
  - EMI details if applicable
- **Payment History:**
  - Table showing all payments
  - Breakdown of principal vs interest paid
- **Collaterals:**
  - List of all collateral items
  - Gold details and estimated value

**Record a Payment:**

1. Click "Record Payment" button
2. Enter payment amount
3. Select payment date
4. Add notes (optional)
5. See **real-time allocation preview**:
   - How much goes to overdue interest
   - How much goes to current interest
   - How much goes to principal
   - Any excess amount
6. Click "Record Payment" to save

**Capitalize Interest (Admin Only):**

- Click "Capitalize Interest" button
- Confirm the action
- Outstanding interest gets added to principal
- Interest calculation resets from today

---

## 🎯 What You Can Do Now

### ✅ Fully Working Features

**Contacts:**

- [x] View all contacts in grid layout
- [x] Search and filter contacts
- [x] View contact details with financial summary
- [x] See total lent/borrowed amounts
- [x] See count of active loans per contact

**Loans:**

- [x] View all loans in table format
- [x] Filter loans by direction, type, status, contact
- [x] View complete loan details
- [x] See real-time outstanding balance
- [x] Record payments with automatic allocation
- [x] Preview payment allocation before committing
- [x] View payment history with breakdown
- [x] Capitalize interest (admin only)
- [x] View loan collaterals

**Collaterals:**

- [x] View all collaterals linked to a loan
- [x] See gold details (weight, carat, rate)
- [x] Auto-calculated gold value from live API
- [x] Estimated value display

---

## 🔧 Developer Quick Reference

### Docker Commands

```bash
# View all services status
docker-compose ps

# View backend logs
docker-compose logs -f backend

# View frontend logs
docker-compose logs -f frontend

# Restart a service
docker-compose restart backend
docker-compose restart frontend

# Rebuild and restart
docker-compose up --build

# Stop all services
docker-compose down

# Complete reset (WARNING: deletes database)
docker-compose down -v
docker-compose up --build
```

### Database Commands

```bash
# Access PostgreSQL CLI
docker-compose exec postgres psql -U admin -d finance_tracker

# Run migrations
docker-compose exec backend alembic upgrade head

# Create new migration
docker-compose exec backend alembic revision --autogenerate -m "description"

# View migration history
docker-compose exec backend alembic history
```

### API Testing

- Visit http://localhost:8000/docs
- All endpoints documented with "Try it out" buttons
- JWT authentication required for most endpoints
- Get token from `/api/auth/login` first

---

## 📊 API Endpoints Summary

### Authentication

```
POST /api/auth/login          # Login and get tokens
POST /api/auth/refresh        # Refresh access token
POST /api/auth/logout         # Logout
GET  /api/auth/me            # Get current user info
```

### Contacts

```
GET    /api/contacts              # List all (with filters)
POST   /api/contacts              # Create new
GET    /api/contacts/{id}         # Get one (with summary)
PUT    /api/contacts/{id}         # Update
DELETE /api/contacts/{id}         # Soft delete
```

### Loans

```
GET    /api/loans                      # List all (with filters)
POST   /api/loans                      # Create new
GET    /api/loans/{id}                 # Get one (with all details)
PUT    /api/loans/{id}                 # Update
DELETE /api/loans/{id}                 # Soft delete
GET    /api/loans/{id}/outstanding     # Calculate outstanding
POST   /api/loans/{id}/payments        # Record payment
GET    /api/loans/{id}/payment-preview # Preview allocation
POST   /api/loans/{id}/capitalize      # Capitalize interest
GET    /api/loans/{id}/schedule        # Get EMI schedule
```

### Collaterals

```
GET    /api/loans/{loan_id}/collaterals  # List for loan
POST   /api/loans/{loan_id}/collaterals  # Add to loan
PUT    /api/collaterals/{id}             # Update
DELETE /api/collaterals/{id}             # Delete
GET    /api/collaterals/{id}/gold-rate   # Fetch live gold rate
```

---

## 🐛 Troubleshooting

### Frontend not loading?

```bash
# Check if service is running
docker-compose ps

# Restart frontend
docker-compose restart frontend

# Check logs for errors
docker-compose logs -f frontend
```

### Backend API not responding?

```bash
# Check if service is running
docker-compose ps

# Restart backend
docker-compose restart backend

# Check logs for errors
docker-compose logs -f backend
```

### Can't login?

```bash
# Check if database has admin user
docker-compose exec postgres psql -U admin -d finance_tracker -c "SELECT * FROM users;"

# If no users, restart backend to trigger seed
docker-compose restart backend
```

### Database issues?

```bash
# Complete reset (WARNING: deletes all data)
docker-compose down -v
docker-compose up --build

# Backend will auto-seed admin user on startup
```

---

## 📝 Test Data

Currently the system starts empty. You can:

1. **Create test contacts** using API docs (http://localhost:8000/docs)
2. **Create test loans** linked to contacts
3. **Record test payments** to see allocation working
4. **Test filters and search** on both contacts and loans

### Sample API Call (via Swagger UI):

1. Go to http://localhost:8000/docs
2. Click "Authorize" button
3. Login with admin/admin123
4. Try POST /api/contacts to create a contact
5. Try POST /api/loans to create a loan
6. Try POST /api/loans/{id}/payments to record payment

---

## 🎊 What's Working vs What's Coming

### ✅ Phase 2 Complete (NOW)

- Contacts: List, Detail, Search, Filter, Financial Summary
- Loans: List, Detail, Filter, Outstanding Calculation
- Payments: Record with Real-time Allocation Preview
- Collaterals: View, Gold Rate API Integration
- Interest Capitalization (Admin only)

### 🔜 Phase 3 (Next)

- Property Deals: Buy, Sell, Hold properties
- Property Transactions: Track property money flow
- Partnerships: Joint ventures tracking
- Partnership Transactions: Money in/out of partnerships

### 🔜 Phase 4 (Later)

- Dashboard Analytics with Charts
- Expense Tracking
- Alerts and Notifications
- Reports and Exports
- Advanced Filters

---

## 💡 Tips

1. **Use the search** - Both contacts and loans have powerful search functionality
2. **Preview payments** - Always check the allocation preview before recording
3. **Filters persist** - Your filter selections stay while navigating
4. **Outstanding is real-time** - Calculated fresh every time you view a loan
5. **Admin features** - Only admin can capitalize interest
6. **Soft deletes** - Deleted items are hidden, not permanently removed
7. **Responsive design** - Works on desktop, tablet, and mobile

---

## 🎯 Next Steps

### To Continue Development:

1. Review PROMPT.md for Phase 3 requirements
2. Review MOMENTO.md for current state
3. Start building Property Deals module
4. Then move to Partnerships module

### To Use the System:

1. Login at http://localhost:5173
2. Start creating contacts
3. Create loans for those contacts
4. Record payments as they come in
5. Monitor outstanding balances

---

**🎉 Everything is ready to go! Happy tracking!**

Need help? Check PHASE2_COMPLETE.md for detailed documentation.
