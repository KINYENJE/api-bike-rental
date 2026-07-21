const IntaSend = require('intasend-node');

// IntaSend maps its own lifecycle states onto our three-state model.
// Reference: COMPLETE = settled, FAILED is terminal, everything else is in-flight.
const STATE_MAP = {
  COMPLETE: 'paid',
  FAILED: 'failed',
  PENDING: 'pending',
  PROCESSING: 'pending',
  RETRY: 'pending',
};

const getClient = () => {
  const publishableKey = process.env.INTASEND_PUBLISHABLE_KEY;
  const secretKey = process.env.INTASEND_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    throw new Error('IntaSend keys are not configured. Set INTASEND_PUBLISHABLE_KEY and INTASEND_SECRET_KEY.');
  }

  // INTASEND_TEST_MODE defaults to true so we never hit live rails by accident.
  const testMode = process.env.INTASEND_TEST_MODE !== 'false';

  return new IntaSend(publishableKey, secretKey, testMode);
};

/**
 * Create a hosted checkout link the user is redirected to in order to pay
 * (supports M-Pesa STK Push and cards).
 */
const createCheckout = async ({ amount, email, firstName, lastName, apiRef, redirectUrl, host }) => {
  const collection = getClient().collection();

  const resp = await collection.charge({
    first_name: firstName,
    last_name: lastName,
    email,
    host,
    amount,
    currency: 'KES',
    api_ref: apiRef,
    redirect_url: redirectUrl,
  });

  return {
    checkoutId: resp.id,
    signature: resp.signature,
    checkoutUrl: resp.url,
    invoiceId: resp.invoice?.invoice_id,
    raw: resp,
  };
};

/**
 * Ask IntaSend for the current state of a payment. Used to confirm on redirect
 * back from checkout, so confirmation does not depend on a public webhook URL.
 */
const verifyPayment = async ({ invoiceId, checkoutId, signature }) => {
  const collection = getClient().collection();

  const resp = await collection.status(invoiceId || '', checkoutId || '', signature || '');
  const invoice = resp.invoice || {};
  const providerState = invoice.state;

  return {
    status: STATE_MAP[providerState] || 'pending',
    providerState,
    invoiceId: invoice.invoice_id || invoiceId,
    amount: invoice.value != null ? Number(invoice.value) : undefined,
    // What we actually receive after IntaSend's fee.
    netAmount: invoice.net_amount != null ? Number(invoice.net_amount) : undefined,
    trackingId: invoice.tracking_id,
    raw: resp,
  };
};

module.exports = { createCheckout, verifyPayment, STATE_MAP };
