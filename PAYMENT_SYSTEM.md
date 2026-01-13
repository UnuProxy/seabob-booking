# Payment & Refund System Documentation

## Overview

The SeaBob Center booking system now includes a **bulletproof payment and refund tracking system** designed to ensure no payment failures and complete financial transparency for admins, brokers, and agencies.

---

## ✅ Features Implemented

### 1. **Automatic Payment Tracking via Stripe**
- **Stripe Webhook Integration** (`/api/stripe/webhook`)
  - Automatically updates bookings when Stripe payments succeed
  - Handles `checkout.session.completed` events
  - Marks booking as `pago_realizado: true` and auto-confirms booking
  - Stores payment method, reference, and timestamp
  - **Secure**: Validates webhook signatures to prevent fraud

### 2. **Manual Payment Recording**
For payments received through other methods (cash, bank transfer, etc.):
- **Admin Interface**: Payment management button on each booking
- **Payment Methods Supported**:
  - 💵 Efectivo (Cash)
  - 🏦 Transferencia Bancaria (Bank Transfer)
  - 💳 Tarjeta (Manual Card Payment)
  - 🔒 Stripe (Automatic)
  - 🔧 Otro (Other)
- **Fields Captured**:
  - Payment method
  - Payment reference (transaction ID, receipt number, etc.)
  - Timestamp (automatic)
- **Auto-Confirmation**: When payment is marked as received, booking is auto-confirmed

### 3. **Refund Management System**
- **Full Refund Tracking**:
  - Refund amount (full or partial)
  - Refund method
  - Refund reason (required)
  - Refund reference
  - Timestamp
- **Auto-Cancellation**: When refund is processed, booking is auto-cancelled
- **Complete Audit Trail**: All refund details stored permanently

### 4. **Payment Status Filters**
- **Filter Bookings by Payment Status**:
  - ✅ **Pagado** - Paid and not refunded
  - ⏰ **Pendiente** - Payment not received
  - 🔄 **Reembolsado** - Refund processed
  - 📋 **Todos** - All bookings
- Easily identify unpaid bookings to follow up

### 5. **Payment History Display**
- **Booking Details Modal** now shows:
  - Payment details (method, reference, timestamp)
  - Refund details (amount, method, reason, timestamp)
  - Color-coded: Green for payments, Red for refunds
  - Complete audit trail for financial accountability

### 6. **Commission System Integration**
- Commissions are calculated from **product commission rates**, not user accounts
- Real-time commission tracking for brokers/agencies
- Commission payment tracking in admin panel
- Separate from booking payments (avoid confusion)

---

## 📊 Database Schema Updates

### Booking Type Updates (`src/types/index.ts`)

```typescript
export interface Booking {
  // ... existing fields ...
  
  // Payment tracking
  pago_realizado?: boolean;
  pago_realizado_en?: Date | string;
  pago_metodo?: PaymentMethod;
  pago_referencia?: string;
  stripe_checkout_session_id?: string;
  stripe_payment_link?: string;
  stripe_payment_intent_id?: string;
  
  // Refund tracking
  reembolso_realizado?: boolean;
  reembolso_monto?: number;
  reembolso_fecha?: Date | string;
  reembolso_motivo?: string;
  reembolso_metodo?: PaymentMethod;
  reembolso_referencia?: string;
  stripe_refund_id?: string;
  
  // ... other fields ...
}

export type PaymentMethod = 
  | 'stripe'          // Stripe payment
  | 'efectivo'        // Cash
  | 'transferencia'   // Bank transfer
  | 'tarjeta'         // Card payment (manual)
  | 'otro';           // Other
```

---

## 🔧 Technical Implementation

### 1. Stripe Webhook (`/api/stripe/webhook/route.ts`)
- **Endpoint**: `POST /api/stripe/webhook`
- **Events Handled**:
  - `checkout.session.completed` - Auto-update booking on payment
  - `charge.refunded` - Log refunds
  - `payment_intent.succeeded` - Log successful payments
  - `payment_intent.payment_failed` - Log failed payments
- **Security**: Validates Stripe signature with `STRIPE_WEBHOOK_SECRET`
- **Graceful Degradation**: If Stripe not configured, webhook returns 503 (doesn't break app)

### 2. Stripe Checkout Session (`/api/stripe/create-checkout/route.ts`)
- **Endpoint**: `POST /api/stripe/create-checkout`
- **Request Body**:
  ```json
  {
    "bookingId": "booking_123",
    "amount": 250.00,
    "currency": "eur",
    "customerEmail": "client@example.com",
    "customerName": "John Doe"
  }
  ```
- **Response**:
  ```json
  {
    "sessionId": "cs_test_...",
    "url": "https://checkout.stripe.com/c/pay/..."
  }
  ```
- **Metadata**: Passes `booking_id` to webhook for auto-update

### 3. Payment/Refund Manager Component (`/components/bookings/PaymentRefundManager.tsx`)
- **Beautiful UI**: Modern, intuitive modal interface
- **Real-time Updates**: Uses Firestore to update booking immediately
- **Validation**:
  - Payment method required
  - Refund amount validation (cannot exceed total)
  - Refund reason required
- **State Management**:
  - Shows different UI based on payment/refund status
  - Cannot refund unpaid bookings
  - Shows payment details when already paid

### 4. Admin Reservas Integration
- **Payment Button**: Shows on every booking card/row
  - 💳 Orange "Cobrar" for unpaid bookings
  - ✅ Green "Pago" for paid bookings
- **Payment Filter Buttons**: Quick access to filter by payment status
- **Payment History**: Shows in booking details modal

---

## 🚀 Setup Instructions

### 1. Environment Variables

Create a `.env.local` file:

```env
# Stripe Configuration (Optional - for automatic payment processing)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2. Stripe Setup (Optional)

If you want automatic Stripe payments:

1. **Get Stripe Keys**:
   - Go to https://dashboard.stripe.com/apikeys
   - Copy your **Secret Key** → `STRIPE_SECRET_KEY`

2. **Setup Webhook**:
   - Go to https://dashboard.stripe.com/webhooks
   - Click "Add endpoint"
   - URL: `https://your-domain.com/api/stripe/webhook`
   - Events to listen: `checkout.session.completed`, `charge.refunded`, `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET`

3. **Test Webhook Locally**:
   ```bash
   # Install Stripe CLI
   brew install stripe/stripe-cli/stripe
   
   # Login
   stripe login
   
   # Forward webhooks to local server
   stripe listen --forward-to http://localhost:3000/api/stripe/webhook
   ```

### 3. Manual Payment Mode (No Stripe Required)

**The system works perfectly without Stripe!** All payment tracking can be done manually:
- Admin marks payments as received
- Tracks payment method and reference
- Full refund management
- Complete audit trail

---

## 📝 Usage Guide

### For Admins

#### Record a Payment (Manual)
1. Go to **Admin → Reservas**
2. Find the booking
3. Click the **💳 Cobrar** button (orange if unpaid)
4. Select payment method (Efectivo, Transferencia, etc.)
5. Enter payment reference (optional but recommended)
6. Click **"Marcar como Pagado"**
7. ✅ Done! Booking is now confirmed and paid

#### Process a Refund
1. Go to **Admin → Reservas**
2. Find the paid booking
3. Click the **✅ Pago** button
4. Scroll to **"Procesar Reembolso"** section
5. Enter refund amount (full or partial)
6. Enter refund reason (required)
7. Select refund method
8. Enter refund reference (optional)
9. Click **"Procesar Reembolso"**
10. ✅ Done! Booking is cancelled and refund recorded

#### Filter by Payment Status
1. Go to **Admin → Reservas**
2. Use the **"Pago:"** filter buttons:
   - **Pagado** - See all paid bookings
   - **Pendiente** - See unpaid bookings to follow up
   - **Reembolsado** - See refunded bookings
   - **Todos** - See everything

#### View Payment History
1. Click **👁️ Detalles** on any booking
2. Scroll to **"Historial de Pagos y Reembolsos"**
3. See complete payment and refund details with timestamps

---

## 🛡️ Security & Data Integrity

### ✅ Payment Security
- **Stripe Webhook Signature Validation**: Prevents fake payment notifications
- **Reference Tracking**: Every payment has a unique reference
- **Timestamp Tracking**: Exact time of all financial transactions
- **Audit Trail**: Complete history of all changes

### ✅ Refund Protection
- **Reason Required**: Cannot process refund without explanation
- **Amount Validation**: Cannot refund more than booking total
- **Cannot Refund Unpaid**: Must be paid before refund
- **Auto-Cancel**: Refunded bookings auto-cancelled to prevent confusion

### ✅ Financial Accountability
- **Immutable Records**: All payment/refund data stored permanently
- **Complete History**: Shows who, when, how much, and why
- **Real-time Updates**: Firestore ensures all admins see latest data
- **No Payment Failures**: System prevents incomplete transactions

---

## 📈 Future Enhancements (Optional)

1. **Automatic Payment Reminders**
   - Send email to clients with unpaid bookings
   - WhatsApp integration for payment links

2. **Partial Payment Support**
   - Allow deposits (e.g., 50% upfront, 50% on delivery)
   - Track multiple payments per booking

3. **Stripe Refund Integration**
   - Auto-process refunds through Stripe API
   - One-click refund for Stripe payments

4. **Export Financial Reports**
   - CSV export of all payments by date range
   - Monthly financial summaries
   - Tax reports

5. **Multi-Currency Support**
   - Support USD, GBP, etc. alongside EUR
   - Automatic currency conversion tracking

---

## 🆘 Troubleshooting

### Stripe Webhook Not Working
- **Check webhook secret**: Ensure `STRIPE_WEBHOOK_SECRET` matches Stripe dashboard
- **Test locally**: Use Stripe CLI to forward webhooks
- **Check logs**: Look at browser console for webhook events

### Payment Not Updating
- **Check Firestore permissions**: Ensure admin has write access to `bookings` collection
- **Refresh page**: Real-time listeners should update automatically
- **Check browser console**: Look for Firebase errors

### Commission Not Calculating
- **Check product commission**: Ensure products have `comision` field set
- **Check booking creation**: `comision_total` should be calculated on save
- **Verify user role**: Ensure booking has `broker_id` or `agency_id`

---

## 📞 Support

For issues or questions:
- Check browser console for errors
- Review Firestore security rules
- Verify environment variables
- Test Stripe webhook signature

---

**Built with ❤️ for SeaBob Center Ibiza**

*Last Updated: January 2026*
