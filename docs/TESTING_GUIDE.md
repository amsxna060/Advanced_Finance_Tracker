# 🧪 Complete Testing Guide - Phase 2

## ✅ System Ready for Testing!

All features are now complete and ready to test. Follow this guide to thoroughly test the application.

---

## 🚀 Quick Start

1. **Ensure Docker is running:**

   ```bash
   docker-compose ps
   # All services should show "Up"
   ```

2. **Access the application:**
   - Frontend: http://localhost:5173
   - Login: `admin` / `admin123`

3. **Sample data already added:**
   - 3 Contacts (Rajesh Kumar, Priya Sharma, Amit Patel)
   - Ready to add loans via UI!

---

## 📋 Complete Testing Checklist

### ✅ 1. Authentication Tests

**Test Login:**

- [ ] Go to http://localhost:5173/login
- [ ] Enter: admin / admin123
- [ ] Click "Login"
- [ ] Should redirect to dashboard
- [ ] Should see "Welcome back, admin!"

**Test Auto-Logout:**

- [ ] Wait 15+ minutes (token expiry)
- [ ] Try to navigate to any page
- [ ] Should auto-redirect to login

**Test Logout:**

- [ ] Click "Logout" button
- [ ] Should redirect to login page
- [ ] Try going back to /dashboard
- [ ] Should redirect to login

---

### ✅ 2. Contact Management Tests

**View Contacts:**

- [ ] Click "Contacts" card on dashboard
- [ ] Should see 3 contacts with cards
- [ ] Each card shows: name, phone, city, contact type

**Search Contacts:**

- [ ] Type "Rajesh" in search box
- [ ] Should filter to show only Rajesh Kumar
- [ ] Clear search
- [ ] All contacts should appear again

**Filter Contacts:**

- [ ] Select "Borrower" from type filter
- [ ] Should show only Rajesh (borrower)
- [ ] Select "Lender"
- [ ] Should show only Priya (lender)
- [ ] Click "Clear Filters"

**Create New Contact:**

- [ ] Click "+ Add Contact" button
- [ ] Fill in form:
  - Name: Test User
  - Phone: +91 99999 88888
  - Email: test@example.com
  - Contact Type: Both
  - City: Bangalore
  - Address: Test Address
  - Notes: Test notes
- [ ] Click "Create Contact"
- [ ] Should redirect to contact detail page
- [ ] Should see all entered information

**View Contact Detail:**

- [ ] Click on any contact card
- [ ] Should show:
  - Contact information
  - Financial summary cards (Total Lent, Total Borrowed, Active Loans)
  - Quick action buttons
  - Back button

**Edit Contact:**

- [ ] Go to contact detail page
- [ ] URL: manually change to /contacts/{id}/edit
- [ ] Update phone number
- [ ] Click "Update Contact"
- [ ] Should redirect to detail page
- [ ] Should show updated phone number

**Validation Tests:**

- [ ] Try creating contact without name → Should show error
- [ ] Try creating contact without phone → Should show error
- [ ] Try invalid email format → Should show error
- [ ] Try invalid phone format → Should show error

---

### ✅ 3. Loan Management Tests

**View Loans:**

- [ ] Click "Loans" card on dashboard
- [ ] Should see loan list (currently empty or sample loans)
- [ ] Should see table headers and filters

**Create Interest Only Loan:**

- [ ] Click "+ New Loan" button
- [ ] **Step 1 - Direction:**
  - Select Contact: Rajesh Kumar
  - Click "Given (Lent Out)" card
  - Click "Next Step"
- [ ] **Step 2 - Type:**
  - Click "Interest Only" card
  - Click "Next Step"
- [ ] **Step 3 - Details:**
  - Principal Amount: 750000
  - Interest Rate: 12.5
  - Start Date: 2026-03-01
  - Interest Start Date: 2026-03-01
  - Capitalization After: 12 months
  - Notes: Test interest-only loan
  - Click "Create Loan"
- [ ] Should redirect to loan detail page
- [ ] Should see outstanding balance (principal + interest)

**Create EMI Loan:**

- [ ] Go to /loans and click "+ New Loan"
- [ ] **Step 1:** Select Amit Patel, click "Taken (Borrowed)"
- [ ] **Step 2:** Click "EMI" card
- [ ] **Step 3:**
  - Principal: 500000
  - Interest Rate: 10
  - Start Date: 2026-02-01
  - EMI Amount: 20000
  - Tenure: 30 months
  - EMI Day: 5
  - Notes: Test EMI loan
  - Click "Create Loan"
- [ ] Should see loan details with EMI information

**Create Short Term Loan:**

- [ ] Click "+ New Loan"
- [ ] **Step 1:** Select Test User (created earlier), click "Given"
- [ ] **Step 2:** Click "Short Term" card
- [ ] **Step 3:**
  - Principal: 100000
  - Interest Rate: 15
  - Start Date: 2026-03-10
  - Maturity Date: 2026-05-10
  - Interest Free Till: 2026-03-20
  - Post-Due Rate: 20
  - Notes: Test short-term loan
  - Click "Create Loan"
- [ ] Should see loan details

**Filter Loans:**

- [ ] Go to /loans
- [ ] Filter by Direction: "Given" → Should show only given loans
- [ ] Filter by Type: "EMI" → Should show only EMI loans
- [ ] Filter by Status: "Active" → Should show active loans
- [ ] Select Contact from dropdown → Should filter by contact
- [ ] Search by contact name → Should filter results
- [ ] Click "Clear Filters" → All loans visible

**View Loan Detail:**

- [ ] Click on any loan row
- [ ] Should see:
  - Outstanding balance card (blue gradient)
  - Loan information section
  - Payment history table (if any payments)
  - Collaterals section (if any)
  - Quick actions sidebar
  - Contact details card

---

### ✅ 4. Payment Recording Tests

**Record First Payment:**

- [ ] Open any active loan detail
- [ ] Click "Record Payment" button
- [ ] Modal should open
- [ ] Enter amount: 10000
- [ ] Select today's date
- [ ] Add notes: "Test payment"
- [ ] Should see **allocation preview** update:
  - Overdue Interest Paid: X
  - Current Interest Paid: Y
  - Principal Paid: Z
  - Total matches entered amount
- [ ] Click "Record Payment"
- [ ] Modal should close
- [ ] Should see payment in history table
- [ ] Outstanding balance should update

**Test Payment Allocation Preview:**

- [ ] Click "Record Payment"
- [ ] Enter different amounts (5000, 20000, 50000)
- [ ] Preview should update each time
- [ ] Shows breakdown of allocation
- [ ] If excess, shows "Excess Amount"
- [ ] Click "Cancel" to close without saving

**Record Multiple Payments:**

- [ ] Record 2-3 more payments
- [ ] Each with different amounts and dates
- [ ] All should appear in payment history
- [ ] Outstanding should decrease correctly

**Payment Validation:**

- [ ] Try recording payment with 0 amount → Should disable button
- [ ] Try negative amount → Should disable button
- [ ] Try without date → Should show error

---

### ✅ 5. Interest Capitalization Tests (Admin Only)

**Capitalize Interest:**

- [ ] Open loan with outstanding interest > 0
- [ ] Should see "Capitalize Interest" button (only if admin)
- [ ] Click button
- [ ] Confirm dialog should appear
- [ ] Click "OK"
- [ ] Outstanding interest should be added to principal
- [ ] Interest outstanding should reset to current accrual only
- [ ] Should see capitalization in loan events/history

---

### ✅ 6. Outstanding Calculation Tests

**Verify Outstanding Accuracy:**

- [ ] Create loan with known values
- [ ] Manually calculate expected outstanding:
  - Days since start × principal × rate / 365
- [ ] Compare with displayed outstanding
- [ ] Should match

**Test Date Changes:**

- [ ] Outstanding balance shows "As of [today's date]"
- [ ] Value should be calculated fresh each view
- [ ] Never stored in database

---

### ✅ 7. Navigation Tests

**Dashboard Navigation:**

- [ ] All 4 cards should be clickable
- [ ] Contacts card → /contacts
- [ ] Loans card → /loans
- [ ] Properties/Partnerships → disabled (Phase 3)

**Breadcrumb Navigation:**

- [ ] Contact detail has "Back to Contacts" button
- [ ] Loan detail has "Back to Loans" button
- [ ] Forms have "Back" buttons and "Cancel" buttons
- [ ] All navigation should work correctly

**Direct URL Access:**

- [ ] Try /contacts/1 → Should show contact detail
- [ ] Try /loans/1 → Should show loan detail
- [ ] Try /contacts/999 → Should show "Not Found" message
- [ ] Try /loans/999 → Should show "Not Found" message

---

### ✅ 8. Responsive Design Tests

**Desktop (1920x1080):**

- [ ] All cards display in grids properly
- [ ] Tables are readable
- [ ] Forms are well-spaced
- [ ] Modal appears centered

**Tablet (iPad - 768px):**

- [ ] Grid layouts adjust to 2 columns
- [ ] Tables scroll horizontally if needed
- [ ] Forms stack properly
- [ ] All buttons accessible

**Mobile (iPhone - 375px):**

- [ ] Cards stack vertically
- [ ] Tables scroll horizontally
- [ ] Forms are single column
- [ ] Modals are full-width
- [ ] Touch targets are large enough

---

### ✅ 9. Error Handling Tests

**Network Errors:**

- [ ] Stop backend: `docker-compose stop backend`
- [ ] Try creating contact → Should show error message
- [ ] Restart: `docker-compose start backend`
- [ ] Should work again

**Validation Errors:**

- [ ] Try submitting forms with missing required fields
- [ ] Should show field-specific errors in red
- [ ] Error messages should be clear

**Authentication Errors:**

- [ ] Manually clear localStorage
- [ ] Try accessing /dashboard
- [ ] Should redirect to login

---

### ✅ 10. Data Persistence Tests

**Verify Data Survives Restart:**

- [ ] Create contact and loan
- [ ] Note the details
- [ ] Restart containers: `docker-compose restart`
- [ ] Login again
- [ ] Data should still be there
- [ ] All calculations should be correct

---

## 🎯 Expected Results Summary

After completing all tests:

- [ ] **3+ Contacts** created and visible
- [ ] **3+ Loans** created (1 of each type)
- [ ] **Multiple payments** recorded
- [ ] **Outstanding balances** calculated correctly
- [ ] **All filters** working
- [ ] **All navigation** working
- [ ] **No errors** in browser console (F12)
- [ ] **No errors** in backend logs

---

## 🐛 If You Find Issues

1. **Check browser console (F12):**
   - Look for JavaScript errors
   - Note any failed API calls

2. **Check backend logs:**

   ```bash
   docker-compose logs backend --tail=50
   ```

3. **Check frontend logs:**

   ```bash
   docker-compose logs frontend --tail=50
   ```

4. **Common fixes:**
   - Hard refresh: Ctrl+Shift+R (Cmd+Shift+R on Mac)
   - Clear browser cache
   - Restart containers: `docker-compose restart`
   - Rebuild: `docker-compose up --build`

---

## 📊 Performance Checks

- [ ] Loan list loads in < 2 seconds
- [ ] Contact list loads in < 2 seconds
- [ ] Payment preview updates instantly
- [ ] No lag when typing in search boxes
- [ ] Smooth navigation between pages

---

## ✅ Phase 2 Sign-Off Criteria

All features must work:

- [x] Authentication (login, logout, auto-refresh)
- [x] Contacts CRUD (create, read, update, soft delete)
- [x] Loans CRUD for all 3 types
- [x] Payment recording with allocation
- [x] Outstanding calculation (day-level precision)
- [x] Interest capitalization (admin only)
- [x] Search and filtering
- [x] Responsive design
- [x] Error handling
- [x] Data persistence

---

## 🚀 Next: Phase 3 Development

Once all tests pass, Phase 3 includes:

- Property Deals CRUD
- Property Transactions
- Partnerships CRUD
- Partnership Transactions
- Dashboard Analytics
- Expense Tracking

---

**Happy Testing! 🎉**

Report any issues found, and we'll fix them before moving to Phase 3.
