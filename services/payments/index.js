// Provider-agnostic payment interface.
//
// The rest of the app (routes, dashboards) only ever talks to this module, so
// swapping or adding a provider means adding an adapter here — not touching
// booking logic or the earnings analytics.
//
// An adapter must export:
//   createCheckout({ amount, email, firstName, lastName, apiRef, redirectUrl, host })
//     -> { checkoutId, signature, checkoutUrl, invoiceId }
//   verifyPayment({ invoiceId, checkoutId, signature })
//     -> { status: 'pending'|'paid'|'failed', providerState, invoiceId, amount }

const intasend = require('./intasend');

const ADAPTERS = {
  intasend,
};

const activeName = process.env.PAYMENT_PROVIDER || 'intasend';

const getProvider = (name = activeName) => {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new Error(`Unknown payment provider: ${name}`);
  }
  return adapter;
};

module.exports = {
  name: activeName,
  getProvider,
  createCheckout: (args) => getProvider().createCheckout(args),
  verifyPayment: (args) => getProvider().verifyPayment(args),
};
