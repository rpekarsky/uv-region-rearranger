import { beforeEach, describe, expect, it } from 'vitest';
import type { Region, SerializedConfig } from './types';
import { useEditorStore } from './store';
import { applyPoint, buildRegionMatrix } from './geometry/transform';

// ---------- helpers ----------

const fakeImg = (w: number, h: number): HTMLImageElement =>
  ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as unknown as HTMLImageElement;

const resetStore = (): void => {
  // Reset only the state fields; keep action references intact.
  useEditorStore.setState({
    originalImage: null,
    originalFilename: null,
    transformedImage: null,
    transformedFilename: null,
    regions: [],
    selectedRegionId: null,
    selectedSide: 'right',
    mode: { kind: 'idle' },
    hoveredHandle: null,
    hoveredVertex: null,
    hoveredZone: null,
    bgFill: { color: '#000000', transparent: false },
    regionsOnlyView: false,
    loupeAlwaysOn: true,
    showRegionNames: false,
    rightVertexEditUnlocked: false,
    zonesRatio: 0.5,
    regionImageSize: null,
    outputCanvasSize: null,
    originalCanvasSize: null,
  });
};

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
    rotation: 0,
    scale: [1, 1],
    skew: [0, 0],
    pivot: [150, 150],
  },
  ...over,
});

const baseCfg = (regions: Region[], imageSize: [number, number]): SerializedConfig => ({
  version: 1,
  imageSize,
  outputCanvasSize: null,
  originalCanvasSize: null,
  imageSourceFilename: null,
  bgFill: { color: '#000000', transparent: false },
  regions,
});

beforeEach(resetStore);

// ---------- JSON-then-image ordering (the user's historical bug) ----------

describe('JSON-then-image load order', () => {
  it('rescales polygon and pivot to source-space ratio', () => {
    const store = useEditorStore.getState();
    store.loadConfig(baseCfg([mkRegion()], [2048, 1024]));
    store.setOriginalImage(fakeImg(1024, 512), 'a.png');

    const r = useEditorStore.getState().regions[0];
    // Polygon (source space) scales by 0.5
    expect(r.polygon).toEqual([
      [50, 50],
      [100, 50],
      [100, 100],
      [50, 100],
    ]);
    // Pivot (source space) scales by 0.5
    expect(r.transform.pivot[0]).toBeCloseTo(75);
    expect(r.transform.pivot[1]).toBeCloseTo(75);
    // translate (output space) compensated per-axis: t' = t - (s-1)*pivot_old.
    //   x: 50 - (-0.5)*150 = 125
    //   y:  0 - (-0.5)*150 = 75
    expect(r.transform.translate[0]).toBeCloseTo(125);
    expect(r.transform.translate[1]).toBeCloseTo(75);
    // scale compensated: 1 / 0.5 = 2
    expect(r.transform.scale[0]).toBeCloseTo(2);
    expect(r.transform.scale[1]).toBeCloseTo(2);
  });

  it('preserves rendered output position across the rescale (the core invariant)', () => {
    const store = useEditorStore.getState();
    const original = mkRegion({
      transform: {
        translate: [50, -20],
        rotation: 0.4,
        scale: [1.3, 0.7],
        skew: [0, 0],
        pivot: [150, 150],
      },
    });

    // Before image load: render under JSON-declared basis
    store.loadConfig(baseCfg([original], [2048, 1024]));
    const Mbefore = buildRegionMatrix(useEditorStore.getState().regions[0].transform);
    const polyBefore = useEditorStore
      .getState()
      .regions[0].polygon.map((p) => applyPoint(Mbefore, p));

    // After image load with different dims
    store.setOriginalImage(fakeImg(1024, 512), 'a.png');
    const after = useEditorStore.getState().regions[0];
    const Mafter = buildRegionMatrix(after.transform);
    const polyAfter = after.polygon.map((p) => applyPoint(Mafter, p));

    // Output-space rendered positions must match (this is what the user sees on the right zone).
    polyBefore.forEach((p, i) => {
      expect(polyAfter[i][0]).toBeCloseTo(p[0], 6);
      expect(polyAfter[i][1]).toBeCloseTo(p[1], 6);
    });
  });

  it('drags outputCanvasSize and originalCanvasSize along by the same ratio', () => {
    const store = useEditorStore.getState();
    store.loadConfig({
      ...baseCfg([mkRegion()], [2048, 1024]),
      outputCanvasSize: [2048, 1024],
      originalCanvasSize: [2048, 1024],
    });
    store.setOriginalImage(fakeImg(1024, 512), 'a.png');
    const s = useEditorStore.getState();
    expect(s.outputCanvasSize).toEqual([1024, 512]);
    expect(s.originalCanvasSize).toEqual([1024, 512]);
    expect(s.regionImageSize).toEqual([1024, 512]);
  });

  it('matching dims do nothing destructive', () => {
    const store = useEditorStore.getState();
    store.loadConfig(baseCfg([mkRegion()], [1024, 512]));
    const before = useEditorStore.getState().regions[0];
    store.setOriginalImage(fakeImg(1024, 512), 'a.png');
    const after = useEditorStore.getState().regions[0];
    expect(after.polygon).toEqual(before.polygon);
    expect(after.transform).toEqual(before.transform);
  });
});

// ---------- image-then-JSON ordering ----------

describe('image-then-JSON load order', () => {
  it('parseConfig denormalizes against the loaded image dims, not cfg.imageSize', async () => {
    const store = useEditorStore.getState();
    store.setOriginalImage(fakeImg(1024, 512), 'a.png');

    // Round-trip via parseConfig requires the storage module. Import lazily so
    // the store is the focus of this test file.
    const { parseConfig } = await import('./io/storage');

    // JSON authored at 2048x1024 with a region at polygon [100,100]..[200,200]
    // (UV [0.0488..0.0976, 0.0976..0.1953]).
    const json = {
      version: 1,
      imageSize: [2048, 1024],
      outputCanvasSize: null,
      originalCanvasSize: null,
      imageSourceFilename: null,
      bgFill: { color: '#000', transparent: false },
      regions: [
        {
          id: 'r1',
          name: '1',
          polygon: [
            [100 / 2048, 100 / 1024],
            [200 / 2048, 100 / 1024],
            [200 / 2048, 200 / 1024],
            [100 / 2048, 200 / 1024],
          ],
          transform: {
            translate: [50 / 2048, 0],
            rotation: 0,
            scale: [1, 1],
            skew: [0, 0],
            pivot: [150 / 2048, 150 / 1024],
          },
        },
      ],
    };

    const cfg = parseConfig(json);
    // Denormalized against loaded image (1024x512), not JSON's 2048x1024.
    expect(cfg.imageSize).toEqual([1024, 512]);
    expect(cfg.regions[0].polygon).toEqual([
      [50, 50],
      [100, 50],
      [100, 100],
      [50, 100],
    ]);
    expect(cfg.regions[0].transform.pivot[0]).toBeCloseTo(75);
    expect(cfg.regions[0].transform.translate[0]).toBeCloseTo(25);
  });

  it('round-trip via the store: load JSON, see same rendered output as serialized state', async () => {
    const store = useEditorStore.getState();
    const { parseConfig, serializeState } = await import('./io/storage');

    store.setOriginalImage(fakeImg(1024, 512), 'a.png');
    store.loadConfig(
      parseConfig({
        version: 1,
        imageSize: [2048, 1024],
        outputCanvasSize: null,
        originalCanvasSize: null,
        imageSourceFilename: null,
        bgFill: { color: '#000', transparent: false },
        regions: [
          {
            id: 'r1',
            name: '1',
            polygon: [
              [0, 0],
              [0.5, 0],
              [0.5, 0.5],
              [0, 0.5],
            ],
            transform: {
              translate: [0.1, 0],
              rotation: 0.2,
              scale: [1.5, 1],
              skew: [0, 0],
              pivot: [0.25, 0.25],
            },
          },
        ],
      }),
    );

    // Now dump and re-parse — should be a fixed point under the loaded image basis.
    const dumped = serializeState();
    expect(dumped.imageSize).toEqual([1024, 512]);

    const reparsed = parseConfig(JSON.parse(JSON.stringify(dumped)));
    const before = useEditorStore.getState().regions[0];
    const after = reparsed.regions[0];
    expect(after.polygon).toEqual(before.polygon);
    expect(after.transform.translate[0]).toBeCloseTo(before.transform.translate[0]);
    expect(after.transform.translate[1]).toBeCloseTo(before.transform.translate[1]);
    expect(after.transform.pivot[0]).toBeCloseTo(before.transform.pivot[0]);
    expect(after.transform.pivot[1]).toBeCloseTo(before.transform.pivot[1]);
  });
});

// ---------- loadConfig reset (H-3) ----------

describe('loadConfig resets selection and per-session UI gates', () => {
  it('clears selectedSide back to right and re-locks vertex edits', () => {
    const store = useEditorStore.getState();
    // Manually set up dirty state
    useEditorStore.setState({
      selectedSide: 'left',
      rightVertexEditUnlocked: true,
      selectedRegionId: 'whatever',
    });
    store.loadConfig(baseCfg([], [100, 100]));
    const s = useEditorStore.getState();
    expect(s.selectedSide).toBe('right');
    expect(s.rightVertexEditUnlocked).toBe(false);
    expect(s.selectedRegionId).toBeNull();
    expect(s.mode).toEqual({ kind: 'idle' });
  });
});

// ---------- setTransformedImage rescale (M-5 territory) ----------

describe('setTransformedImage rescales region transforms', () => {
  it('scales translate when output basis changes (rendered position invariant)', () => {
    const store = useEditorStore.getState();
    store.setOriginalImage(fakeImg(1024, 1024), 'a.png');
    store.loadConfig({
      ...baseCfg([mkRegion()], [1024, 1024]),
      outputCanvasSize: [1024, 1024],
    });
    const before = useEditorStore.getState().regions[0];
    const Mbefore = buildRegionMatrix(before.transform);
    const renderedBefore = before.polygon.map((p) => applyPoint(Mbefore, p));

    // Drop a transformed image at half output size
    store.setTransformedImage(fakeImg(512, 512), 'gen.png');
    const after = useEditorStore.getState().regions[0];
    const Mafter = buildRegionMatrix(after.transform);
    const renderedAfter = after.polygon.map((p) => applyPoint(Mafter, p));

    // Output-space rendered positions should scale by 0.5
    renderedBefore.forEach((p, i) => {
      expect(renderedAfter[i][0]).toBeCloseTo(p[0] * 0.5, 6);
      expect(renderedAfter[i][1]).toBeCloseTo(p[1] * 0.5, 6);
    });
    expect(useEditorStore.getState().outputCanvasSize).toEqual([512, 512]);
  });

  it('no rescale when no prior basis exists', () => {
    const store = useEditorStore.getState();
    store.setTransformedImage(fakeImg(800, 600), 'gen.png');
    const s = useEditorStore.getState();
    expect(s.outputCanvasSize).toEqual([800, 600]);
    expect(s.regions).toEqual([]);
  });
});

// ---------- nudgeSelected branching ----------

describe('nudgeSelected routes by selectedSide for regions', () => {
  it('right side updates transform.translate', () => {
    const store = useEditorStore.getState();
    useEditorStore.setState({
      regions: [mkRegion()],
      selectedRegionId: 'r1',
      selectedSide: 'right',
    });
    store.nudgeSelected(5, -3);
    const r = useEditorStore.getState().regions[0];
    expect(r.transform.translate).toEqual([55, -3]);
    expect(r.polygon).toEqual([
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ]);
  });

  it('left side translates source polygon vertices', () => {
    const store = useEditorStore.getState();
    useEditorStore.setState({
      regions: [mkRegion()],
      selectedRegionId: 'r1',
      selectedSide: 'left',
    });
    store.nudgeSelected(5, -3);
    const r = useEditorStore.getState().regions[0];
    expect(r.transform.translate).toEqual([50, 0]);
    expect(r.polygon).toEqual([
      [105, 97],
      [205, 97],
      [205, 197],
      [105, 197],
    ]);
  });
});
