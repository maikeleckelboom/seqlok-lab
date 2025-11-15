import { describe, expect, it } from 'vitest';

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  type ControllerOptions,
  defineSpec,
  planLayout,
  type RangePolicy,
  receiveHandoff,
} from '../../src';

/**
 * Spec used across tests:
 * - Scalars: rate (f32, [0.5, 2]), mode (enum), enabled (bool)
 * - Array param: coeffs (f32[8])
 * - Meters: rms (f32), spectrum (f32[16]), flags (u32[8]) — used in other file
 */
function makeSpec() {
  return defineSpec(({ param, meter }) => ({
    id: 'controller-binding-tests',
    params: {
      rate: param.f32({ min: 0.5, max: 2.0 }),
      mode: param.enum(['a', 'b', 'c']),
      enabled: param.bool(),
      coeffs: param.f32.array({ length: 8 }),
    },
    meters: {
      rms: meter.f32(),
      spectrum: meter.f32.array(16),
      flags: meter.u32.array(8),
    },
  }));
}

function setupController(
  options: ControllerOptions = { params: { rangePolicy: 'reject' } },
) {
  const spec = makeSpec();
  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  const handoff = buildHandoff(plan, backing);
  const received = receiveHandoff(handoff);

  const ctl = bindController(spec, backing, options);
  const proc = bindProcessor(received);

  return { spec, plan, backing, handoff, received, ctl, proc };
}

describe('Controller params: version bumps exactly once per successful commit', () => {
  it('set(): single scalar write → exactly one PU bump', () => {
    const { ctl } = setupController();
    const start = ctl.params.version();

    ctl.params.set('rate', 1.25);
    const v1 = ctl.params.version();
    expect(v1).toBe(start + 1);

    // sanity for stored value
    const snap = ctl.params.snapshot({ keys: ['rate'] });
    expect(snap.rate).toBeCloseTo(1.25, 6);
  });

  it('update(): multiple scalars in one call → exactly one PU bump', () => {
    const { ctl } = setupController();
    const start = ctl.params.version();

    ctl.params.update({
      rate: 1.5,
      enabled: true,
      mode: 'b',
    });

    const v1 = ctl.params.version();
    expect(v1).toBe(start + 1);

    const snap = ctl.params.snapshot({ keys: ['rate', 'enabled', 'mode'] });
    expect(snap.rate).toBeCloseTo(1.5, 6);
    expect(snap.enabled).toBe(true);
    // enum PI32 scalar relabeled to string on snapshot
    expect(snap.mode).toBe('b');
  });

  it('stage(): array edit is one commit → exactly one PU bump', () => {
    const { ctl } = setupController();
    const start = ctl.params.version();

    ctl.params.stage('coeffs', (view) => {
      view.fill(0);
      view[2] = 0.75;
      view[7] = 0.33;
    });

    const v1 = ctl.params.version();
    expect(v1).toBe(start + 1);

    const snap = ctl.params.snapshot({ keys: ['coeffs'] });
    expect(snap.coeffs).toBeInstanceOf(Float32Array);
    expect((snap.coeffs as Float32Array)[2]).toBeCloseTo(0.75, 6);
    expect((snap.coeffs as Float32Array)[7]).toBeCloseTo(0.33, 6);
  });
});

describe('Controller params: range policy behavior with default reject', () => {
  it('default policy is reject: out-of-range set() throws and version does not bump', () => {
    const { ctl } = setupController(); // default: reject
    const start = ctl.params.version();

    expect(() => {
      ctl.params.set('rate', 999); // > max=2.0
    }).toThrow(); // Typed SeqlokError with binding.paramRange

    const v1 = ctl.params.version();
    expect(v1).toBe(start); // no bump on failure
  });

  it('clamp policy: out-of-range values clamp and commit (one bump)', () => {
    const { ctl } = setupController({ params: { rangePolicy: 'clamp' } });
    const start = ctl.params.version();

    ctl.params.set('rate', -10); // < min=0.5 ⇒ clamps to 0.5
    const v1 = ctl.params.version();
    expect(v1).toBe(start + 1);

    const snap = ctl.params.snapshot({ keys: ['rate'] });
    expect(snap.rate).toBeCloseTo(0.5, 6);
  });
});

describe('Controller params: snapshot into() identity and key validation', () => {
  it('params.snapshot({keys, into}) reuses provided buffer (identity)', () => {
    const { ctl } = setupController();
    // Ensure some content exists first
    ctl.params.stage('coeffs', (view) => {
      view[0] = 0.1;
      view[1] = 0.2;
      view[2] = 0.3;
      view[3] = 0.4;
      view[4] = 0.5;
      view[5] = 0.6;
      view[6] = 0.7;
      view[7] = 0.8;
    });

    const into = { coeffs: new Float32Array(8) };
    const snap = ctl.params.snapshot({ keys: ['coeffs'], into });
    // identity check
    expect(snap.coeffs).toBe(into.coeffs);
    // content check (couple of elements)
    expect(snap.coeffs[2]).toBeCloseTo(0.3, 6);
    expect(snap.coeffs[7]).toBeCloseTo(0.8, 6);
  });

  it('unknown key in params.snapshot() throws', () => {
    const { ctl } = setupController();
    expect(() => {
      // @ts-expect-error intentional invalid key to test guard
      ctl.params.snapshot({ keys: ['doesNotExist'] });
    }).toThrow();
  });
});
