import { describe, expect, it } from 'vitest';

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from '../../src';

function createHarness() {
  const spec = defineSpec(({ meter }) => ({
    id: 'demo',
    meters: {
      rms: meter.f32(),
      flags: meter.u32.array(64),
      spectrum: meter.f32.array(512),
    },
  }));

  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  // Golden flow: build → receive → bind
  const handoff = buildHandoff(plan, backing);
  const received = receiveHandoff(handoff);

  const ctl = bindController(spec, backing);
  const proc = bindProcessor(received);

  return { ctl, proc };
}

describe('meters.snapshot into identity', () => {
  it('returns provided into buffers by identity for each array key', () => {
    const { ctl, proc } = createHarness();

    proc.meters.publish((w) => {
      w.rms(0.42);
      w.stage('flags', (dst) => {
        dst.fill(0);
        dst[0] = 1;
      });
      w.stage('spectrum', (dst) => {
        for (let i = 0; i < dst.length; i++) {
          dst[i] = i;
        }
      });
    });

    const f32 = new Float32Array(512);
    const u32 = new Uint32Array(64);

    const snap = ctl.meters.snapshot({
      keys: ['spectrum', 'flags', 'rms'],
      into: {
        spectrum: f32,
        flags: u32,
      },
    });

    expect(snap.spectrum).toBe(f32);
    expect(snap.flags).toBe(u32);
    expect(snap.rms).toBeTypeOf('number');
    expect(f32[0]).toBe(0);
    expect(u32[0]).toBe(1);
  });

  it('allocates fresh arrays only for keys not present in into', () => {
    const { ctl } = createHarness();

    const f32 = new Float32Array(512);
    const sub = ctl.meters.snapshot({
      keys: ['spectrum', 'flags'],
      into: {
        spectrum: f32,
      },
    });

    expect(sub.spectrum).toBe(f32);
    expect(sub.flags).toBeInstanceOf(Uint32Array);
    expect(sub.flags).not.toBe(f32);
  });
});
