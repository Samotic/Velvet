import type { Request, Response } from 'express';

import { configured, env } from '../config/env';
import { fail, ok } from '../utils/http';

/**
 * Velvet Pro checkout.
 *
 * Stripe is called over its REST API with `fetch` rather than the SDK: this is
 * one endpoint creating one Checkout Session, and a dependency for that is
 * more surface than the feature is worth. Card details never touch Velvet —
 * the browser is redirected to Stripe's hosted page.
 *
 * Without STRIPE_SECRET_KEY the route answers 503 and the UI says payments
 * aren't configured, which is honest and keeps the rest of the app running.
 */

/** £4.99/month, in the smallest currency unit, matching the pricing page. */
const PRICE_PENCE = 499;
const CURRENCY = 'gbp';

export async function checkout(req: Request, res: Response): Promise<Response> {
  if (!configured.stripe()) {
    return fail(res, 'Payments are not configured on this server', 503);
  }

  try {
    // Stripe's API takes form-encoded bodies, including for nested fields.
    const form = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': CURRENCY,
      'line_items[0][price_data][unit_amount]': String(PRICE_PENCE),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'Velvet Pro',
      'line_items[0][price_data][product_data][description]':
        'Unlimited AI advisor messages and weekly picks.',
      success_url: `${env.frontendUrl}/settings?upgraded=1`,
      cancel_url: `${env.frontendUrl}/pro`,
      // Ties the resulting subscription back to the account for the webhook
      // that will eventually flip `isPro`.
      client_reference_id: req.user!.userId,
      'metadata[userId]': req.user!.userId,
    });

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });

    const payload = (await response.json()) as { url?: string; error?: { message?: string } };

    if (!response.ok || !payload.url) {
      console.error('stripe checkout error:', payload.error ?? response.statusText);
      return fail(res, 'Could not start checkout', 502);
    }

    return ok(res, { url: payload.url });
  } catch (err) {
    console.error('checkout error:', err);
    return fail(res, 'Could not start checkout', 502);
  }
}
