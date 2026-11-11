import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyBaseLogger, FastifyError, FastifyPluginAsync } from 'fastify';
import { shoppers } from '../shared/demo-shoppers.js';
import type { Telemetry } from './telemetry.js';
import { routes, type Route, type RequestError, type RequestLog } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    checkoutError: RequestError | null;
    checkoutDetails: RequestLog['checkout'] | null;
  }
}

const product = { id: 'field-notebook', name: 'Field notebook', priceCents: 1200 };

function checkoutError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

export const checkoutRoutes: FastifyPluginAsync<{ telemetry: Telemetry }> = async (app, { telemetry }) => {
  const carts = new Map<string, { expiresAt: number; currency: string }>();
  app.decorateRequest('checkoutError', null);
  app.decorateRequest('checkoutDetails', null);

  app.addHook('preHandler', async () => {
    await delay(35 + Math.random() * 85);
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode ?? 500;
    const details = {
      code: error.code ?? 'CHECKOUT_ERROR',
      message: status < 500 ? error.message : 'An unexpected checkout error occurred.',
    };
    request.checkoutError = details;
    reply.code(status).send(details);
  });
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url;
    if (!routes.includes(route as Route)) return;
    telemetry.record({
      requestId: request.id,
      userId: request.headers['x-sim-user']?.toString() ?? null,
      flowId: request.headers['x-sim-flow']?.toString() ?? null,
      method: request.method,
      route: route as Route,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      error: request.checkoutError,
      ...(request.checkoutDetails && { checkout: request.checkoutDetails }),
    });
  });

  app.get('/products', async () => [product]);

  app.post<{ Body: { productId: string; currency?: string } }>('/cart', {
    schema: {
      body: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' }, currency: { type: 'string', pattern: '^[A-Za-z]{3}$' } },
      },
    },
  }, async (request, reply) => {
    const { productId, currency = 'USD' } = request.body;
    if (productId !== product.id) {
      throw checkoutError(404, 'PRODUCT_NOT_FOUND', 'That product is unavailable.');
    }
    const now = Date.now();
    for (const [id, { expiresAt }] of carts) {
      if (expiresAt <= now) carts.delete(id);
    }
    const cartId = randomUUID();
    carts.set(cartId, { expiresAt: now + 60_000, currency });
    request.checkoutDetails = { cartId, currency };
    return reply.code(201).send({
      cartId,
      totalCents: product.priceCents,
      ...(telemetry.currentFlags().cart_item_details && { item: { ...product, quantity: 1 } }),
    });
  });

  app.post<{ Body: { cartId: string; currency?: string } }>('/checkout', {
    schema: {
      body: {
        type: 'object',
        required: ['cartId'],
        properties: { cartId: { type: 'string' }, currency: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { cartId, currency } = request.body;
    const cart = carts.get(cartId);
    if (!cart || cart.expiresAt <= Date.now()) {
      throw checkoutError(404, 'CART_NOT_FOUND', 'The cart expired or has already been checked out.');
    }

    const flags = telemetry.currentFlags();
    const paymentCurrency = currency?.toUpperCase() ?? cart.currency;
    request.checkoutDetails = { cartId, currency: paymentCurrency };
    if (flags.strict_payment_validation && paymentCurrency !== cart.currency) {
      throw checkoutError(502, 'PAYMENT_PROVIDER_REJECTED', 'The payment provider rejected the request.');
    }

    carts.delete(cartId);
    const orderId = randomUUID();
    return reply.code(201).send({
      orderId,
      totalCents: product.priceCents,
      ...(flags.order_receipts && { receipt: `receipt-${orderId}` }),
    });
  });
};

export function startShoppers(origin: string, logger: FastifyBaseLogger) {
  const controller = new AbortController();
  const { signal } = controller;

  async function run({ id: userId, currency }: (typeof shoppers)[number], index: number) {
    await delay(index * 420, undefined, { signal });
    for (let runNumber = 1; !signal.aborted; runNumber++) {
      const headers = { 'x-sim-user': userId, 'x-sim-flow': `${userId}-${runNumber}` };
      async function send<T>(path: string, body?: Record<string, string>): Promise<T | null> {
        const response = await fetch(`${origin}/shop${path}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
          method: body ? 'POST' : 'GET',
          headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
          body: body && JSON.stringify(body),
        });
        const data = await response.json();
        return response.ok ? data as T : null;
      }

      try {
        const products = await send<Array<{ id: string }>>('/products');
        if (products?.length) {
          await delay(500, undefined, { signal });
          const cart = await send<{ cartId: string }>('/cart', { productId: products[0].id, currency });
          if (cart) {
            await delay(650, undefined, { signal });
            await send('/checkout', { cartId: cart.cartId, ...(runNumber % 2 === 1 && { currency }) });
          }
        }
      } catch (error) {
        if (!signal.aborted) logger.warn({ err: error, userId }, 'Simulated shopper request failed');
      }
      await delay(1_600 + Math.random() * 900, undefined, { signal });
    }
  }

  const runs = shoppers.map((shopper, index) => run(shopper, index).catch(error => {
    if (!signal.aborted) logger.error({ err: error, userId: shopper.id }, 'Simulated shopper stopped');
  }));

  return async () => {
    controller.abort();
    await Promise.all(runs);
  };
}
