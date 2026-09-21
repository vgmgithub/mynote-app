// The pure part of the checkout: no browser, no network, so it can be tested on its own.

// What to say for each way step 1 (creating the order) can fail. Plain words; the technical cause stays on the server.
export function createOrderMessage(status) {
  if (status === 503) return 'Payments are not set up on this server yet.';
  if (status === 401) return 'The payment service refused this server’s login. Nothing was charged.';
  if (status === 400) return 'That request was not valid. Nothing was charged.';
  return 'Could not start the payment. Nothing was charged. Try again in a moment.';
}
