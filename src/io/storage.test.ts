import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../store';
import { parseConfig, serializeState } from './storage';
import type { Region } from '../types';

const fakeImg = (w: number, h: number): HTMLImageElement =>
  ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as unknown as HTMLImageElement;

const mkRegion = (over: Partial<Region> = {}): Region => ({
  id: 'r1',
  name: '1',
  polygon: [
    [100, 100],
    [200, 100],
    [200, 200],
    [100, 200],
  ],
  transform: {
    translate: [50, 0],
    rotation: 0.3,
    scale: [1.5, 1],
    skew: [0, 0],
    pivot: [150, 150],
  },
  ...over,
});

beforeEach(() => {
  useEditorStore.setState({
    originalImage: null,
    transformedImage: null,
    regions: [],
    regionImageSize: null,
    outputCanvasSize: null,
    originalCanvasSize: null,
    bgFill: { color: '#000000', transparent: false },
    selectedRegionId: null,
    selectedSide: 'right',
    rightVertexEditUnlocked: false,
    mode: { kind: 'idle' },
  });
});

describe('serialize → parse round-trip with image loaded', () => {
  it('preserves polygon and transform under same image dims', () => {
    const store = useEditorStore.getState();
    store.setOriginalImage(fakeImg(2048, 1024), 'a.png');
    store.loadConfig({
      version: 1,
      imageSize: [2048, 1024],
      outputCanvasSize: null,
      originalCanvasSize: null,
      imageSourceFilename: null,
      bgFill: { color: '#000000', transparent: false },
      regions: [mkRegion()],
    });

    const dumped = serializeState();
    expect(dumped.imageSize).toEqual([2048, 1024]);

    const reparsed = parseConfig(JSON.parse(JSON.stringify(dumped)));
    const before = useEditorStore.getState().regions[0];
    const after = reparsed.regions[0];

    expect(after.polygon).toEqual(before.polygon);
    (['translate', 'pivot', 'scale', 'skew'] as const).forEach((k) => {
      expect(after.transform[k][0]).toBeCloseTo(before.transform[k][0], 9);
      expect(after.transform[k][1]).toBeCloseTo(before.transform[k][1], 9);
    });
    expect(after.transform.rotation).toBeCloseTo(before.transform.rotation, 9);
  });
});

describe('serializeState basis selection', () => {
  it('throws when no source size known', () => {
    expect(() => serializeState()).toThrow('Cannot save');
  });

  it('uses regionImageSize when no original image is loaded', () => {
    const store = useEditorStore.getState();
    store.loadConfig({
      version: 1,
      imageSize: [800, 600],
      outputCanvasSize: null,
      originalCanvasSize: null,
      imageSourceFilename: null,
      bgFill: { color: '#000000', transparent: false },
      regions: [],
    });
    expect(serializeState().imageSize).toEqual([800, 600]);
  });

  it('original image wins over JSON-tracked regionImageSize', () => {
    const store = useEditorStore.getState();
    store.setOriginalImage(fakeImg(1024, 1024), 'a.png');
    expect(serializeState().imageSize).toEqual([1024, 1024]);
  });
});

describe('parseConfig validation', () => {
  it('rejects non-object input', () => {
    expect(() => parseConfig(null)).toThrow('Invalid JSON');
    expect(() => parseConfig(42)).toThrow('Invalid JSON');
  });
  it('rejects unsupported version', () => {
    expect(() => parseConfig({ version: 2, regions: [] })).toThrow('Unsupported');
  });
  it('rejects missing regions array', () => {
    expect(() => parseConfig({ version: 1 })).toThrow('Missing regions');
  });
  it('rejects when no image loaded and JSON has no imageSize', () => {
    expect(() => parseConfig({ version: 1, regions: [] })).toThrow('no original image');
  });
  it('defaults missing skew field to [0,0] (back-compat)', () => {
    const cfg = parseConfig({
      version: 1,
      imageSize: [100, 100],
      regions: [
        {
          id: 'r1',
          name: '1',
          polygon: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          transform: {
            translate: [0, 0],
            rotation: 0,
            scale: [1, 1],
            // skew omitted
            pivot: [0.5, 0.5],
          },
        },
      ],
      masks: [],
    });
    expect(cfg.regions[0].transform.skew).toEqual([0, 0]);
  });
});
