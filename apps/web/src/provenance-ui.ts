import type { Provenance, ProviderStatus } from '@simulation/schemas';
import type { Wire } from './api';
import { h } from './dom';
import { fmtDuration, fmtUtc } from './format';

/** Generic, reusable provenance display: where did this number come from? */

const KIND_HELP: Record<string, string> = {
  OBSERVED: 'Reported by an instrument or data provider at a real time.',
  PROPAGATED:
    'An observed initial condition advanced in time by a published theory. Not a live measurement.',
  MODELLED: 'Evaluated from a model of the environment. Not a measurement.',
  SIMULATED: 'Produced by Simulation’s own dynamics.',
};

export function kindBadge(kind: string): HTMLElement {
  return h(
    'span',
    { class: `badge kind-${kind.toLowerCase()}`, title: KIND_HELP[kind] ?? '' },
    kind,
  );
}

export function freshnessBadge(f: string | undefined): HTMLElement | null {
  return f ? h('span', { class: `badge fresh-${f.toLowerCase()}` }, f) : null;
}

export function provenanceBlock(p: Provenance): HTMLElement {
  const row = (k: string, v: string | HTMLElement | null | undefined): HTMLElement | null =>
    v === null || v === undefined || v === ''
      ? null
      : h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  return h(
    'div',
    { class: 'prov' },
    h(
      'div',
      { class: 'prov-head' },
      kindBadge(p.stateKind),
      freshnessBadge(p.freshness),
      p.subject ? h('span', { class: 'dim' }, p.subject) : null,
    ),
    row('Source', [p.source.provider, p.source.dataset].filter(Boolean).join(' · ')),
    row('Source epoch', p.sourceEpochUtc ? fmtUtc(p.sourceEpochUtc) : undefined),
    row('Retrieved', p.retrievedAtUtc ? fmtUtc(p.retrievedAtUtc) : undefined),
    row('Simulation time', fmtUtc(p.simulationTimeUtc)),
    row(
      'Data age',
      p.dataAgeSeconds === null || p.dataAgeSeconds === undefined
        ? undefined
        : fmtDuration(p.dataAgeSeconds),
    ),
    row('Model', p.model ? [p.model.name, p.model.version].filter(Boolean).join(' ') : undefined),
    row('Frame', p.frame),
    row('Attribution', p.source.attribution),
    row('Licence', p.source.license),
    p.limitations?.length
      ? h('ul', { class: 'limits' }, ...p.limitations.map((l) => h('li', {}, l)))
      : null,
  );
}

/** Collapsible provenance for a result. */
export function provenanceDetails(
  ps: Provenance[] | undefined,
  label = 'Provenance',
): HTMLElement | null {
  if (!ps?.length) return null;
  return h(
    'details',
    { class: 'prov-details' },
    h('summary', {}, `${label} (${ps.length})`),
    ...ps.map(provenanceBlock),
  );
}

/** Render a wire result: value via `render`, or an explicit refusal with its reason. */
export function resultSection<T>(
  title: string,
  r: Wire<T> | undefined,
  render: (v: T) => (HTMLElement | null)[],
): HTMLElement {
  const head = h('div', { class: 'sec-title' }, title);
  if (!r) return h('section', { class: 'sec' }, head, h('div', { class: 'dim' }, '—'));
  if (r.status === 'ok') {
    return h(
      'section',
      { class: 'sec' },
      head,
      ...render(r.value),
      provenanceDetails(r.provenance),
    );
  }
  return h(
    'section',
    { class: 'sec' },
    head,
    h('div', { class: `refusal ${r.status}` }, h('b', {}, r.status.toUpperCase()), ` ${r.code}`),
    h('div', { class: 'dim' }, r.reason),
    r.status === 'unavailable' ? provenanceDetails(r.provenance, 'Provenance of inputs') : null,
  );
}

export const kv = (k: string, v: string | HTMLElement | null, title?: string): HTMLElement =>
  h(
    'div',
    { class: 'kv', ...(title ? { title } : {}) },
    h('span', { class: 'k' }, k),
    h('span', { class: 'v' }, v),
  );

const STATE_LABEL: Record<string, string> = {
  ok: 'OK',
  stale: 'STALE',
  fixture: 'FIXTURE',
  offline: 'OFFLINE',
  unavailable: 'UNAVAILABLE',
};

export function providerCard(p: ProviderStatus): HTMLElement {
  return h(
    'div',
    { class: 'provider' },
    h(
      'div',
      { class: 'provider-head' },
      h('b', {}, p.label),
      h('span', { class: `badge state-${p.state}` }, STATE_LABEL[p.state] ?? p.state),
    ),
    kv('Origin', p.origin),
    p.retrievedAtUtc ? kv('Retrieved', fmtUtc(p.retrievedAtUtc)) : null,
    p.retrievalAgeSeconds !== undefined
      ? kv('Age', fmtDuration(p.retrievalAgeSeconds).replace('+', ''))
      : null,
    p.nextRefreshNotBeforeUtc ? kv('Next refresh ≥', fmtUtc(p.nextRefreshNotBeforeUtc)) : null,
    p.itemCount !== undefined ? kv('Items', String(p.itemCount)) : null,
    p.lastError ? kv('Last error', p.lastError) : null,
    p.attribution ? kv('Attribution', p.attribution) : null,
    p.license ? kv('Licence', p.license) : null,
    p.notes?.length ? h('ul', { class: 'limits' }, ...p.notes.map((n) => h('li', {}, n))) : null,
  );
}
