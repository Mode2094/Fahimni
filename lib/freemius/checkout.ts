import type { Freemius } from '@freemius/sdk';

export type CheckoutCreator = (input: { planId: string; email: string; name: string | null }) => Promise<string>;

// Official SDK pattern: create a checkout for a server-resolved plan, prefill
// the authenticated email and lock it (readonly_user), then return the hosted
// checkout link. Prices and plan ids never come from the browser.
export function sdkCheckoutCreator(client: Freemius): CheckoutCreator {
  return async ({ planId, email, name }) => {
    const checkout = await client.checkout.create({ planId });
    checkout.setUser(name ? { email, name } : { email }, true);
    return checkout.getLink();
  };
}
