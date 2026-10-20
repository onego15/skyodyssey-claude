// World layout: every hand-placed location in the world lives here so that the
// terrain generator, the missions and the map all agree on where things are.
// Units are metres. +X = east, -Z = north. Headings are degrees clockwise from north.

export const WORLD = {
  minX: -11000, maxX: 13000,
  minZ: -22000, maxZ: 4000,
  boundaryRadius: 17000,
  boundaryCenter: { x: 1000, z: -8500 },
};

export const RUNWAYS = {
  home: {
    id: 'home', name: '暁の飛行場', x: 0, z: 0, heading: 0,
    length: 1100, width: 32, elev: 14, surface: 'asphalt',
    pad: 160, padSide: 70, blend: 260,
  },
  lighthouse: {
    id: 'lighthouse', name: '灯台の島 滑走路', x: 3000, z: -3200, heading: 60,
    length: 760, width: 26, elev: 22, surface: 'grass',
    pad: 120, padSide: 55, blend: 200,
  },
  foothill: {
    id: 'foothill', name: '山麓の滑走路', x: -700, z: -7650, heading: 75,
    length: 950, width: 28, elev: 30, surface: 'asphalt',
    pad: 160, padSide: 70, blend: 320,
  },
  secret: {
    id: 'secret', name: '秘密の滑走路', x: 7500, z: -15500, heading: 110,
    length: 800, width: 28, elev: 86, surface: 'stone',
    pad: 120, padSide: 60, blend: 220,
  },
};

export function runwayAxes(rw) {
  const h = (rw.heading * Math.PI) / 180;
  return {
    dir: { x: Math.sin(h), z: -Math.cos(h) },
    right: { x: Math.cos(h), z: Math.sin(h) },
  };
}

export function runwayLocal(rw, x, z) {
  const { dir, right } = rw._axes || (rw._axes = runwayAxes(rw));
  const dx = x - rw.x, dz = z - rw.z;
  return { along: dx * dir.x + dz * dir.z, across: dx * right.x + dz * right.z };
}

export const ISLANDS = {
  home: { x: 0, z: 0, r: 2100 },
  lighthouse: { x: 3000, z: -3200, r: 1150 },
  mountain: { x: -2000, z: -11800, r: 5400 },
  phantom: { x: 7500, z: -15500, r: 2400 },
};

// Canyon through the mountains, from the hidden basin down to the sea.
export const CANYON = [
  { x: -3100, z: -12300, floor: 330 },
  { x: -2950, z: -11300, floor: 300 },
  { x: -2600, z: -10300, floor: 240 },
  { x: -2350, z: -9300, floor: 150 },
  { x: -2150, z: -8350, floor: 70 },
  { x: -1950, z: -7300, floor: 18 },
  { x: -1900, z: -6200, floor: -6 },
];

export const RUINS = { x: -3150, z: -12500, elev: 332, basinR: 520 };
export const PEAK = { x: -900, z: -13300, height: 1650 };
export const SEA_ARCH = { x: 1650, z: -1500, heading: 40 };
export const SUNKEN = { x: -2600, z: -3600 };
export const CLOUD_SEA = { x: -2300, z: -11900, r: 3900, y: 560 };
export const FOG_BANK = { x: 7500, z: -15500, inner: 2900, outer: 5200 };

// Small rocky islets for scenery.
export const ISLETS = [
  { x: 5200, z: -700, r: 320, h: 45 },
  { x: -3900, z: -1200, r: 420, h: 70 },
  { x: 4600, z: -7400, r: 480, h: 95 },
  { x: -6800, z: -7600, r: 600, h: 140 },
  { x: 2300, z: -9400, r: 330, h: 60 },
  { x: -1800, z: 2600, r: 300, h: 40 },
  { x: 11000, z: -11000, r: 450, h: 80 },
  { x: 3600, z: -19500, r: 520, h: 110 },
];

// Points of interest. Discovering one shows a banner and adds it to the journal.
export const POIS = [
  { id: 'home', name: '暁の飛行場', desc: '旅のはじまり。朝焼けの滑走路。', x: 0, z: 0, y: 30, radius: 500, auto: true },
  { id: 'arch', name: '海の門', desc: '波に削られた巨大な岩のアーチ。くぐり抜けられそうだ。', x: SEA_ARCH.x, z: SEA_ARCH.z, y: 40, radius: 420 },
  { id: 'lighthouse', name: '白亜の灯台', desc: '断崖に立つ古い灯台。今も船乗りを見守っている。', x: 2780, z: -3560, y: 90, radius: 750 },
  { id: 'sunken', name: '沈んだ柱廊', desc: '浅瀬に並ぶ石柱。かつてここに都があったのだろうか。', x: SUNKEN.x, z: SUNKEN.z, y: 20, radius: 450 },
  { id: 'cloudsea', name: '雲海', desc: '山々を包む白い海。この下に何かが眠っている。', x: -1800, z: -9800, y: 600, radius: 1600 },
  { id: 'canyon', name: '巨人の峡谷', desc: '山脈を貫く深い峡谷。川は雲の下へと続いている。', x: -2250, z: -8900, y: 200, radius: 520, maxAlt: 520 },
  { id: 'falls', name: '双子の滝', desc: '峡谷の壁から流れ落ちる二筋の滝。', x: -2560, z: -10050, y: 330, radius: 480 },
  { id: 'peak', name: '天嶺', desc: '山脈の最高峰。雲の上に突き出す白い頂。', x: PEAK.x, z: PEAK.z, y: PEAK.height, radius: 900, minAlt: 1450 },
  { id: 'ruins', name: '風の神殿', desc: '雲海の下に隠された古代遺跡。祭壇の石が淡く光っている。', x: RUINS.x, z: RUINS.z, y: RUINS.elev + 40, radius: 520, maxAlt: 760 },
  { id: 'phantom', name: '幻の島', desc: '霧の向こうに現れた島。地図のどこにも載っていない。', x: 7500, z: -15500, y: 200, radius: 2600 },
  { id: 'floating', name: '浮遊岩', desc: '空に浮かぶ岩塊。風の力が宿っているのか。', x: 7900, z: -15950, y: 420, radius: 450 },
  { id: 'secret', name: '秘密の滑走路', desc: 'カルデラの底に眠る石畳の滑走路。灯火が旅人を迎える。', x: 7500, z: -15500, y: 100, radius: 900, maxAlt: 420 },
];

// Collectible sky crystals hidden in tricky spots.
export const CRYSTALS = [
  { id: 'c1', x: SEA_ARCH.x, z: SEA_ARCH.z, y: 22, hint: '海の門の下' },
  { id: 'c2', x: 2780, z: -3560, y: 128, hint: '灯台の真上' },
  { id: 'c3', x: SUNKEN.x + 60, z: SUNKEN.z - 30, y: 26, hint: '沈んだ柱廊の間' },
  { id: 'c4', x: -2160, z: -8600, y: 105, hint: '峡谷の底' },
  { id: 'c5', x: PEAK.x, z: PEAK.z, y: PEAK.height + 70, hint: '天嶺の頂' },
  { id: 'c6', x: RUINS.x + 40, z: RUINS.z + 260, y: RUINS.elev + 30, hint: '神殿の門' },
  { id: 'c7', x: 7900, z: -15950, y: 380, hint: '浮遊岩の下' },
  { id: 'c8', x: -1800, z: 2600, y: 70, hint: '南の小島の上' },
];
