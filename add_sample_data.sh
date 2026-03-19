#!/bin/bash

# Test script to add sample contact and loan data
# Run this from the project root directory

echo "🚀 Adding sample data to Advanced Finance Tracker..."

# Get auth token
echo "📝 Logging in..."
TOKEN=$(curl -s -X POST "http://localhost:8000/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123" | jq -r '.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ Login failed. Make sure the backend is running on http://localhost:8000"
  exit 1
fi

echo "✅ Login successful"

# Create first contact (Borrower)
echo "👤 Creating contact: Rajesh Kumar..."
CONTACT1=$(curl -s -X POST "http://localhost:8000/api/contacts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rajesh Kumar",
    "phone": "+91 98765 43210",
    "email": "rajesh@example.com",
    "city": "Mumbai",
    "address": "123 MG Road, Andheri",
    "contact_type": "borrower",
    "notes": "Regular customer, good payment history"
  }')

CONTACT1_ID=$(echo $CONTACT1 | jq -r '.id')
echo "✅ Contact created with ID: $CONTACT1_ID"

# Create second contact (Lender)
echo "👤 Creating contact: Priya Sharma..."
CONTACT2=$(curl -s -X POST "http://localhost:8000/api/contacts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Priya Sharma",
    "phone": "+91 87654 32109",
    "email": "priya@example.com",
    "city": "Delhi",
    "address": "456 Connaught Place",
    "contact_type": "lender",
    "notes": "Business partner, provides capital when needed"
  }')

CONTACT2_ID=$(echo $CONTACT2 | jq -r '.id')
echo "✅ Contact created with ID: $CONTACT2_ID"

# Create third contact (Both)
echo "👤 Creating contact: Amit Patel..."
CONTACT3=$(curl -s -X POST "http://localhost:8000/api/contacts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Amit Patel",
    "phone": "+91 76543 21098",
    "city": "Ahmedabad",
    "contact_type": "both",
    "notes": "Sometimes borrows, sometimes lends"
  }')

CONTACT3_ID=$(echo $CONTACT3 | jq -r '.id')
echo "✅ Contact created with ID: $CONTACT3_ID"

# Create loan 1 - Interest Only (Given)
echo "💰 Creating loan 1: Interest Only loan to Rajesh..."
LOAN1=$(curl -s -X POST "http://localhost:8000/api/loans" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"contact_id\": $CONTACT1_ID,
    \"direction\": \"given\",
    \"type\": \"interest_only\",
    \"principal_amount\": 500000,
    \"interest_rate\": 12.0,
    \"start_date\": \"2026-01-01\",
    \"interest_start_date\": \"2026-01-01\",
    \"notes\": \"Business expansion loan\"
  }")

LOAN1_ID=$(echo $LOAN1 | jq -r '.id')
echo "✅ Loan created with ID: $LOAN1_ID"

# Create loan 2 - EMI (Taken)
echo "💰 Creating loan 2: EMI loan from Priya..."
LOAN2=$(curl -s -X POST "http://localhost:8000/api/loans" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"contact_id\": $CONTACT2_ID,
    \"direction\": \"taken\",
    \"type\": \"emi\",
    \"principal_amount\": 1000000,
    \"interest_rate\": 10.0,
    \"start_date\": \"2026-02-01\",
    \"emi_amount\": 45000,
    \"tenure_months\": 24,
    \"emi_day\": 5,
    \"notes\": \"Capital for new investment\"
  }")

LOAN2_ID=$(echo $LOAN2 | jq -r '.id')
echo "✅ Loan created with ID: $LOAN2_ID"

# Create loan 3 - Short Term (Given)
echo "💰 Creating loan 3: Short-term loan to Amit..."
LOAN3=$(curl -s -X POST "http://localhost:8000/api/loans" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"contact_id\": $CONTACT3_ID,
    \"direction\": \"given\",
    \"type\": \"short_term\",
    \"principal_amount\": 200000,
    \"interest_rate\": 15.0,
    \"start_date\": \"2026-03-01\",
    \"maturity_date\": \"2026-06-01\",
    \"interest_free_till\": \"2026-03-15\",
    \"post_due_interest_rate\": 18.0,
    \"notes\": \"Emergency loan, interest-free for 15 days\"
  }")

LOAN3_ID=$(echo $LOAN3 | jq -r '.id')
echo "✅ Loan created with ID: $LOAN3_ID"

# Add a payment to loan 1
echo "💵 Recording payment for loan 1..."
curl -s -X POST "http://localhost:8000/api/loans/$LOAN1_ID/payments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 6000,
    "payment_date": "2026-02-01",
    "notes": "First month interest payment"
  }' > /dev/null

echo "✅ Payment recorded"

echo ""
echo "🎉 Sample data added successfully!"
echo ""
echo "📊 Summary:"
echo "  - 3 Contacts created"
echo "  - 3 Loans created (1 interest-only, 1 EMI, 1 short-term)"
echo "  - 1 Payment recorded"
echo ""
echo "🌐 Access the application:"
echo "  Frontend: http://localhost:5173"
echo "  Login: admin / admin123"
echo ""
echo "✨ You can now view contacts and loans in the UI!"
