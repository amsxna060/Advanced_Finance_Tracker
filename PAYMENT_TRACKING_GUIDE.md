# 📊 Payment Tracking Guide - How to Track All Money Movements

## ✅ Payment Tracking is Already Built In!

The system **already tracks all types of payments** - interest, EMI, partial payments, etc. Let me show you where and how:

---

## 💰 How Payment Tracking Works

### 1. **Recording ANY Payment**

When you record a payment on a loan, the system **automatically** handles:

- ✅ Interest payments (monthly interest)
- ✅ EMI payments (fixed installments)
- ✅ Partial payments (any amount)
- ✅ Full payments (principal + interest)
- ✅ Overpayments (excess refunded)

**Location:** Loan Detail Page → "Record Payment" button

---

## 📍 Where to See All Payment Information

### **1. Loan Detail Page - Payment History Section**

**Path:** Click any loan → Scroll down to "Payment History"

**What You'll See:**

```
Payment History Table:
┌─────────────┬────────────┬───────────────┬────────────────┬────────┐
│ Date        │ Amount     │ Principal Pd  │ Interest Pd    │ Notes  │
├─────────────┼────────────┼───────────────┼────────────────┼────────┤
│ 2026-02-01  │ ₹10,000    │ ₹4,000        │ ₹6,000         │ First  │
│ 2026-03-01  │ ₹15,000    │ ₹9,000        │ ₹6,000         │ Second │
│ 2026-03-15  │ ₹5,000     │ ₹2,000        │ ₹3,000         │ Partial│
└─────────────┴────────────┴───────────────┴────────────────┴────────┘
```

**Each row shows:**

- **Date:** When payment was made
- **Amount:** Total payment received
- **Principal Paid:** How much went to principal
- **Interest Paid:** How much went to interest
- **Notes:** Your custom note (e.g., "Monthly EMI", "Partial payment")

---

### **2. Outstanding Balance Card - Top of Loan Detail**

**What You'll See:**

```
┌─────────────────────────────────────────────────────┐
│  Outstanding Balance                                 │
│  ────────────────────────────────────────           │
│  Principal Outstanding:     ₹450,000                │
│  Interest Outstanding:      ₹18,750                 │
│  Total Due:                 ₹468,750                │
│  As of: March 18, 2026                              │
└─────────────────────────────────────────────────────┘
```

This **automatically calculates** based on:

- All payments recorded
- Days elapsed
- Interest rate
- Loan type

---

### **3. Payment Allocation Preview - Before Recording**

**When recording payment, you see EXACTLY where money goes:**

```
Example: Recording ₹20,000 payment

Payment Allocation Preview:
┌──────────────────────────────────────┐
│ Overdue Interest Paid:   ₹12,000    │  (Old unpaid interest)
│ Current Interest Paid:    ₹5,000    │  (This month's interest)
│ Principal Paid:           ₹3,000    │  (Reduces loan amount)
│ ─────────────────────────────────    │
│ Total Payment:           ₹20,000    │
└──────────────────────────────────────┘
```

---

## 🎯 Common Payment Scenarios - How They're Tracked

### **Scenario 1: Monthly Interest Payment**

**Example:** Interest-only loan, ₹500,000 @ 12% p.a.

- Monthly interest = ₹5,000

**How to track:**

1. Go to loan detail page
2. Click "Record Payment"
3. Enter amount: **₹5,000**
4. Date: First of the month
5. Notes: **"Monthly interest for March 2026"**
6. See preview: ₹0 principal, ₹5,000 interest
7. Click "Record Payment"

**Result:** Payment appears in history with correct breakdown

---

### **Scenario 2: EMI Payment**

**Example:** EMI loan, ₹1,000,000 @ 10%, EMI ₹20,000

**How to track:**

1. Go to loan detail page
2. Click "Record Payment"
3. Enter amount: **₹20,000**
4. Date: EMI due date (e.g., 5th of month)
5. Notes: **"EMI payment - March 2026"**
6. See preview showing principal + interest split
7. Click "Record Payment"

**Result:** System automatically splits into principal and interest

---

### **Scenario 3: Partial Payment (Less than due)**

**Example:** Customer pays ₹8,000 but interest due is ₹10,000

**How to track:**

1. Go to loan detail page
2. Click "Record Payment"
3. Enter amount: **₹8,000**
4. Date: Today
5. Notes: **"Partial payment - paying what they can"**
6. See preview: ₹8,000 goes to interest, ₹0 to principal
7. Click "Record Payment"

**Result:** Interest reduced by ₹8,000, remaining ₹2,000 becomes overdue

---

### **Scenario 4: Overpayment (More than due)**

**Example:** Outstanding is ₹50,000 but customer pays ₹70,000

**How to track:**

1. Go to loan detail page
2. Click "Record Payment"
3. Enter amount: **₹70,000**
4. Date: Today
5. Notes: **"Full payment + extra"**
6. See preview:
   - Interest Paid: ₹15,000
   - Principal Paid: ₹35,000
   - **Excess Amount: ₹20,000** (return to customer)
7. Click "Record Payment"

**Result:** Payment recorded, you know to refund ₹20,000

---

### **Scenario 5: Lump Sum Principal Payment**

**Example:** Customer wants to pay ₹100,000 towards principal

**How to track:**

1. First, calculate current interest due
2. Record payment for: **Interest + ₹100,000**
3. Notes: **"Regular interest + ₹1,00,000 principal prepayment"**
4. System automatically allocates: interest first, then principal

**Result:** Principal reduces by ₹100,000 after interest cleared

---

## 📊 Viewing All Payments Across All Loans

### **Method 1: Contact Financial Summary**

**Path:** Contacts → Click any contact → See summary cards

Shows:

- **Total Lent:** All money given to this person
- **Total Borrowed:** All money received from this person
- **Active Loans:** Number of open loans

### **Method 2: Loan List with Filters**

**Path:** Loans → Use filters

- Filter by **Contact** to see all their loans
- Filter by **Direction** (Given/Taken)
- Filter by **Status** (Active/Closed)
- See all payments in each loan's detail page

---

## 💡 Payment Tracking Best Practices

### **1. Always Add Notes**

```
Good Notes Examples:
✅ "Monthly interest payment for March 2026"
✅ "EMI #12 of 24 - paid via bank transfer"
✅ "Partial payment ₹5,000 - customer facing cash shortage"
✅ "Final principal + interest - loan closed"
✅ "Extra payment ₹20,000 - returned to customer"

Bad Notes Examples:
❌ "Payment" (too generic)
❌ "" (empty)
```

### **2. Record Payments Immediately**

- Don't wait - record as soon as money is received
- Use correct date (backdating is supported)
- System calculates interest up to that date

### **3. Check Outstanding Before Recording**

- Always view current outstanding first
- Use the preview feature
- Verify allocation looks correct
- Then click "Record Payment"

### **4. For Interest-Only Loans**

- Record monthly interest payments regularly
- If missed months, system tracks as "overdue interest"
- Next payment clears overdue interest first

### **5. For EMI Loans**

- Record on the EMI due date each month
- System knows the EMI amount from loan setup
- Auto-splits between principal and interest

### **6. For Short-Term Loans**

- Watch the maturity date
- Interest-free period is automatic
- After maturity, higher interest rate applies

---

## 🔍 Example: Complete Payment History View

**Loan:** ₹500,000 @ 12% p.a., Interest-Only, Started Jan 1, 2026

**Payment History on March 18, 2026:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  Loan #1234 - Rajesh Kumar - Interest Only                           │
│  Principal: ₹500,000 | Rate: 12% p.a. | Started: Jan 1, 2026        │
└──────────────────────────────────────────────────────────────────────┘

Outstanding Balance (as of March 18, 2026)
┌─────────────────────────────────────┐
│ Principal Outstanding:  ₹500,000    │
│ Interest Outstanding:    ₹11,342    │  (18 days of March)
│ Total Due:              ₹511,342    │
└─────────────────────────────────────┘

Payment History
┌─────────────┬───────────┬──────────────┬─────────────┬──────────────────────┐
│ Date        │ Amount    │ Principal Pd │ Interest Pd │ Notes                │
├─────────────┼───────────┼──────────────┼─────────────┼──────────────────────┤
│ 2026-01-31  │ ₹5,000    │ ₹0           │ ₹5,000      │ Jan interest         │
│ 2026-02-28  │ ₹5,000    │ ₹0           │ ₹5,000      │ Feb interest         │
│ 2026-03-01  │ ₹5,000    │ ₹0           │ ₹5,000      │ March interest       │
├─────────────┼───────────┼──────────────┼─────────────┼──────────────────────┤
│ TOTAL       │ ₹15,000   │ ₹0           │ ₹15,000     │                      │
└─────────────┴───────────┴──────────────┴─────────────┴──────────────────────┘

Next Expected Payment: ₹5,000 on April 1, 2026
```

---

## 📱 Quick Access to Payment Features

### **From Dashboard:**

1. Click "Loans" card
2. Click any loan row
3. See outstanding + payment history
4. Click "Record Payment"

### **From Contact:**

1. Click "Contacts" card
2. Click any contact
3. See financial summary
4. Click "Create Loan" or "View All Loans"
5. Access loan detail → Record payments

### **Direct URL:**

```
Loan detail: http://localhost:5173/loans/1
Contact detail: http://localhost:5173/contacts/1
```

---

## ✅ Summary: You Can Already Track

✅ **Interest payments** (monthly/periodic)  
✅ **EMI payments** (principal + interest)  
✅ **Partial payments** (less than due)  
✅ **Full payments** (clearing everything)  
✅ **Overpayments** (with excess calculation)  
✅ **Overdue tracking** (missed payments)  
✅ **Payment history** (complete audit trail)  
✅ **Outstanding calculation** (real-time)  
✅ **Allocation breakdown** (where money goes)  
✅ **Custom notes** (for each payment)

---

## 🎯 What's NOT Included (Coming in Later Phases)

❌ Payment reminders/alerts (Phase 4)  
❌ Automated payment schedules (Phase 4)  
❌ SMS/Email notifications (Phase 4)  
❌ Payment receipt generation (Phase 4)  
❌ Bulk payment import (Phase 4)  
❌ Payment analytics/charts (Phase 4)

---

## 💬 Example Conversation

**You:** "Customer paid ₹10,000 today for their interest-only loan"

**How to track:**

1. Go to Loans page
2. Find and click the loan
3. Click "Record Payment"
4. Amount: 10000
5. Date: Today
6. Notes: "Monthly interest payment"
7. Check preview (should show ₹0 principal, ₹10,000 interest if only interest was due)
8. Click "Record Payment"
9. ✅ Done! Payment tracked, outstanding updated, history recorded

---

**The payment tracking system is fully functional and ready to use!**

All you need to do is:

1. **Record payments** when money comes in
2. **Add notes** to remember context
3. **View history** anytime in loan detail page
4. **Check outstanding** to see what's due

No separate section needed - it's all integrated into the loan management flow!
