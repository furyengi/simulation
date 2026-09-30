import { z } from 'zod';
import { ProvenanceSchema, type Provenance } from './provenance';

/**
 * Every environment query returns one of these. Nothing is ever silently invented:
 *
 * - `ok`          the value, with provenance.
 * - `unsupported` this query is outside what Simulation models (e.g. altitude above the model's
 *                 valid range, a body not yet implemented). Structural; will not change with time.
 * - `unavailable` the query is supportable but required data is missing right now (provider down,
 *                 time outside the data's coverage).
 */
export type EnvResult<T> =
  | { status: 'ok'; value: T; provenance: Provenance[] }
  | { status: 'unsupported'; code: string; reason: string }
  | { status: 'unavailable'; code: string; reason: string; provenance?: Provenance[] };

export const ok = <T>(value: T, ...provenance: Provenance[]): EnvResult<T> => ({
  status: 'ok',
  value,
  provenance,
});
export const unsupported = (code: string, reason: string): EnvResult<never> => ({
  status: 'unsupported',
  code,
  reason,
});
export const unavailable = (
  code: string,
  reason: string,
  provenance?: Provenance[],
): EnvResult<never> => ({
  status: 'unavailable',
  code,
  reason,
  ...(provenance ? { provenance } : {}),
});

export const isOk = <T>(r: EnvResult<T>): r is Extract<EnvResult<T>, { status: 'ok' }> =>
  r.status === 'ok';

/** Wire-format schema builder for an EnvResult carrying `value`. */
export const envResultSchema = <V extends z.ZodType>(value: V) =>
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), value, provenance: z.array(ProvenanceSchema) }),
    z.object({ status: z.literal('unsupported'), code: z.string(), reason: z.string() }),
    z.object({
      status: z.literal('unavailable'),
      code: z.string(),
      reason: z.string(),
      provenance: z.array(ProvenanceSchema).optional(),
    }),
  ]);
