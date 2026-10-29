import Stripe from 'stripe';
import { config } from '../config';

let client: Stripe | undefined;

export function stripe(): Stripe {
  if (!config.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set — payments are disabled until it is added on Railway.');
  }
  client ??= new Stripe(config.STRIPE_SECRET_KEY);
  return client;
}
