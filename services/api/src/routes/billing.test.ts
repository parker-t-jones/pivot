import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { apiErrorHandler } from '../lib/errors.js';
import billingRoutes from './billing.js';
import { resolveRevenueCatTier } from './billing.js';

describe('resolveRevenueCatTier', () => {
  it('grants pro on INITIAL_PURCHASE', () => {
    expect(
      resolveRevenueCatTier({
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user-1',
        entitlement_ids: ['pro'],
      }),
    ).toBe('pro');
  });

  it('revokes on EXPIRATION', () => {
    expect(
      resolveRevenueCatTier({
        type: 'EXPIRATION',
        app_user_id: 'user-1',
        entitlement_ids: [],
      }),
    ).toBe('free');
  });

  it('ignores CANCELLATION (access until EXPIRATION)', () => {
    expect(
      resolveRevenueCatTier({
        type: 'CANCELLATION',
        app_user_id: 'user-1',
        entitlement_ids: ['pro'],
      }),
    ).toBeNull();
  });

  it('PRODUCT_CHANGE without pro entitlement revokes', () => {
    expect(
      resolveRevenueCatTier({
        type: 'PRODUCT_CHANGE',
        app_user_id: 'user-1',
        entitlement_ids: ['other'],
      }),
    ).toBe('free');
  });

  it('grants pro for SANDBOX the same as PRODUCTION', () => {
    const sandbox = resolveRevenueCatTier({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'user-1',
      entitlement_ids: ['pro'],
      environment: 'SANDBOX',
    });
    const production = resolveRevenueCatTier({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'user-1',
      entitlement_ids: ['pro'],
      environment: 'PRODUCTION',
    });
    expect(sandbox).toBe('pro');
    expect(production).toBe(sandbox);
  });

  it('ignores unknown events without pro entitlement', () => {
    expect(
      resolveRevenueCatTier({
        type: 'SUBSCRIBER_ALIAS',
        app_user_id: 'user-1',
        entitlement_ids: [],
      }),
    ).toBeNull();
  });
});

// Route tests use only an in-memory Supabase stand-in; no account or RevenueCat access.

describe('POST /billing/revenuecat', () => {
  afterEach(() => vi.unstubAllEnvs());

  async function setup(rows = [{ id: 'user-1' }], error: object | null = null) {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', 'test-secret');
    const logs: string[] = [];
    const app = Fastify({ logger: { stream: { write: (line: string) => logs.push(line) } } });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(apiErrorHandler);
    const select = vi.fn(async () => ({ data: rows, error }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    // This fake implements only the update chain exercised by the route.
    app.decorate('supabase', { from } as unknown as SupabaseServiceClient);
    await app.register(billingRoutes);
    await app.ready();
    const send = (event: Record<string, unknown>, authorization = 'Bearer test-secret') =>
      app.inject({
        method: 'POST',
        url: '/billing/revenuecat',
        headers: { authorization },
        payload: { event },
      });
    return { app, send, from, update, eq, select, logs };
  }

  it.each([
    ['INITIAL_PURCHASE', 'pro'],
    ['EXPIRATION', 'free'],
  ])('writes %s and reports the matched tier', async (type, tier) => {
    const t = await setup();
    try {
      const response = await t.send({ type, app_user_id: 'user-1', entitlement_ids: ['pro'] });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, tier });
      expect(t.update).toHaveBeenCalledWith({ subscription_tier: tier });
      expect(t.eq).toHaveBeenCalledWith('id', 'user-1');
      expect(t.select).toHaveBeenCalledWith('id');
    } finally {
      await t.app.close();
    }
  });

  it.each([
    ['wrong secret', 401],
    ['missing secret', 503],
  ])('rejects %s without a database call', async (condition, status) => {
    const t = await setup();
    try {
      if (status === 503) vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', '');
      const response = await t.send(
        { type: 'RENEWAL', app_user_id: 'user-1' },
        condition === 'wrong secret' ? 'wrong' : 'test-secret',
      );
      expect(response.statusCode).toBe(status);
      expect(t.from).not.toHaveBeenCalled();
    } finally {
      await t.app.close();
    }
  });

  it('warns on zero matched rows without logging the account id', async () => {
    const t = await setup([]);
    try {
      const response = await t.send({ type: 'RENEWAL', app_user_id: 'unknown-private-id' });
      expect(response.json()).toEqual({ ok: true, tier: null });
      const warnings = t.logs
        .map((line) => JSON.parse(line) as { level: number; type?: string })
        .filter((line) => line.level === 40);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ type: 'RENEWAL' });
      expect(t.logs.join('')).not.toContain('unknown-private-id');
    } finally {
      await t.app.close();
    }
  });

  it.each([
    { type: 'RENEWAL', app_user_id: '$RCAnonymousID:private' },
    { type: 'TRANSFER', transferred_from: ['$RCAnonymousID:private'], transferred_to: ['user-1'] },
  ])('ignores anonymous or missing account ids: $type', async (event) => {
    const t = await setup();
    try {
      const response = await t.send(event);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, tier: null });
      expect(t.from).not.toHaveBeenCalled();
      expect(
        t.logs
          .map((line) => JSON.parse(line))
          .some((line) => line.level === 30 && line.type === event.type),
      ).toBe(true);
      expect(t.logs.join('')).not.toContain('$RCAnonymousID:private');
    } finally {
      await t.app.close();
    }
  });
});
