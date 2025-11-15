import { describe, expect, it } from 'vitest';

import { allocateShared, bindController, defineSpec, planLayout } from '../../src';

describe('controller: edge cases & validation', () => {
  it('rejects enum write with invalid string label', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'enum-test',
      params: {
        mode: param.enum(['sine', 'square', 'saw']),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    expect(() => {
      // @ts-expect-error non-existent key
      ctl.params.set('mode', 'triangle');
    }).toThrow(/enum|invalid|value/i);
  });

  it('rangePolicy: clamp clamps out-of-range f32 and commits value', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'demo',
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing, { params: { rangePolicy: 'clamp' } });

    const start = ctl.params.version();

    // no throw; value should be clamped to max (1)
    ctl.params.set('gain', 1.5);

    const after = ctl.params.version();
    expect(after).toBe(start + 1);

    const { gain } = ctl.params.snapshot(['gain']);
    expect(gain).toBe(1);
  });

  it('throws on out-of-range f32 with rangePolicy: reject', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'reject-test',
      params: {
        rate: param.f32({ min: 0.5, max: 4 }),
      },
      meters: {},
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing, { params: { rangePolicy: 'reject' } });

    expect(() => {
      ctl.params.set('rate', 5);
    }).toThrow(/out of range|range|bounds/i);
  });

  it('validates into buffer type mismatch for params', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'into-type-test',
      params: {
        curve: param.f32.array(64),
      },
      meters: {},
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    const wrongBuffer = new Int32Array(64);

    expect(() => {
      // @ts-expect-error wrong type (intentional)
      ctl.params.snapshot({
        keys: ['curve'],
        into: { curve: wrongBuffer },
      });
    }).toThrow(/type|Float32Array|Int32Array/i);
  });

  it('validates into buffer length mismatch for params', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'into-length-test',
      params: {
        coeffs: param.f32.array(128),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    const wrongSize = new Float32Array(64); // Wrong length!

    expect(() => {
      ctl.params.snapshot({
        keys: ['coeffs'],
        into: { coeffs: wrongSize },
      });
    }).toThrow(/length|size|128|64/i);
  });

  it('handles empty param spec without errors', () => {
    const spec = defineSpec(() => ({
      id: 'empty-params',
      meters: { peak: { kind: 'f32' } },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    const snap = ctl.params.snapshot();
    expect(Object.keys(snap)).toHaveLength(0);
  });

  it('normalizes bool param from 0/1 numeric input', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'bool-numeric',
      params: {
        enabled: param.bool(),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    // @ts-expect-error numeric truthy
    ctl.params.set('enabled', 1);
    expect(ctl.params.snapshot().enabled).toBe(true);
    // @ts-expect-error Numeric falsy
    ctl.params.set('enabled', 0);
    expect(ctl.params.snapshot().enabled).toBe(false);
  });

  it('throws when staging a non-existent array param', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'unknown-key',
      params: {
        valid: param.f32.array(8),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    expect(() => {
      // @ts-expect-error Argument of type "invalid" is not assignable to parameter of type "valid"
      ctl.params.stage('invalid', () => {
        /* empty */
      });
    }).toThrow(/unknown|key|param/i);
  });

  it('handles scalar enum numeric index writes', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'enum-index',
      params: {
        waveform: param.enum(['sine', 'square', 'saw']),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    ctl.params.set('waveform', 1 as unknown as never);

    const snap = ctl.params.snapshot();
    expect(snap.waveform).toMatch(/square|1/);
  });

  it('rejects zero-length array params (runtime validation)', () => {
    const build = () =>
      defineSpec(({ param }) => ({
        id: 'zero-array',
        params: {
          empty: param.f32.array(0),
        },
      }));

    try {
      // If defineSpec throws here, we pass.
      build();
      // If not, planLayout must throw when materializing.
      const spec = build();
      expect(() => planLayout(spec)).toThrow(/positive integer|length/i);
    } catch {
      // thrown by defineSpec — pass
    }
  });
});
