const mongoose = require('mongoose');
const { Schema } = mongoose;

// A payment attempt against a booking. This collection is the source of truth
// for earnings analytics (owner + admin dashboards aggregate over `paidAt`).
const paymentSchema = new Schema({
  booking: {
    type: Schema.Types.ObjectId,
    ref: 'Booking',
    required: [true, 'Booking is required'],
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required'],
  },
  userEmail: {
    type: String,
  },
  // Denormalised so owner/admin earnings queries don't need a join.
  bikeId: {
    type: String,
    required: true,
  },
  bikeOwner: {
    type: String,
    required: true,
  },
  // What was actually charged. Normally equals the booking price, but can be
  // overridden by PAYMENT_TEST_AMOUNT while testing.
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [1, 'Amount must be greater than zero'],
  },
  // The booking's real price, preserved even when a test override is active.
  originalAmount: {
    type: Number,
  },
  // What actually lands after the provider's fee (gross `amount` minus fees).
  // This is the figure owner earnings should be based on.
  netAmount: {
    type: Number,
  },
  // Provider-side human-readable reference (IntaSend tracking_id).
  trackingId: {
    type: String,
  },
  currency: {
    type: String,
    default: 'KES',
  },
  provider: {
    type: String,
    default: 'intasend',
  },
  // Our own reference, sent to the provider as api_ref.
  providerRef: {
    type: String,
    required: true,
    index: true,
  },
  // Provider-side identifiers, used to verify the payment afterwards.
  invoiceId: { type: String },
  checkoutId: { type: String },
  signature: { type: String },
  checkoutUrl: { type: String },

  status: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
  },
  paidAt: {
    type: Date,
  },
  // Ensures confirmation emails are sent exactly once, even if both the webhook
  // and the verify-on-return path confirm the same payment.
  notificationSent: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
