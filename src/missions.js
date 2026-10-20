// The three adventures. Each mission is a short story with objectives that are
// checked against the live game state; discoveries and side goals are optional.
import { RUNWAYS, POIS, ISLANDS, CANYON, FOG_BANK, RUINS, runwayLocal } from './layout.js';

const poi = (id) => POIS.find((p) => p.id === id);
const kmh = (ms) => Math.round(ms * 3.6);

export function takeoffHint(g) {
  const fm = g.fm;
  if (fm.throttle < 0.7) return '<kbd>R</kbd> / <kbd>Shift</kbd> でスロットルを上げよう（80%以上）';
  const v = kmh(fm.speed);
  if (fm.onGround && v < 95) return `滑走中… 速度 ${v} km/h。100 km/h を超えたら <kbd>S</kbd> / <kbd>↓</kbd> で機首を上げる`;
  if (fm.onGround) return '今だ！ <kbd>S</kbd> / <kbd>↓</kbd> を押し続けて機首を上げよう';
  return '離陸成功！ そのまま上昇を続けよう。機首を上げすぎると失速するので注意';
}

export function landingHint(g, rwId) {
  const rw = RUNWAYS[rwId];
  const fm = g.fm;
  const l = runwayLocal(rw, fm.pos.x, fm.pos.z);
  const dist = Math.hypot(fm.pos.x - rw.x, fm.pos.z - rw.z);
  const agl = fm.pos.y - rw.elev;
  if (fm.onGround) {
    if (fm.speed > 3) return '接地！ <kbd>Space</kbd> でブレーキ、スロットルは 0 に';
    return '停止してください';
  }
  if (dist > 3500) return '滑走路の延長線上へ回り込み、高度を 300m 程度まで下げよう';
  const v = kmh(fm.speed);
  let s = '';
  if (Math.abs(l.across) > 120 && dist > 600) s = '滑走路の中心線に機体をそろえよう。';
  if (v > 170) s += 'スロットルを下げて減速（目安 120〜150 km/h）。';
  else if (v < 105) s += '速度が低い！ スロットルを少し上げよう。';
  if (agl < 25 && dist < 900) s += '地面が近い。<kbd>S</kbd> で少しだけ機首を上げて沈下を和らげる（フレア）';
  else if (dist < 2500) s += '右下の PAPI：白2・赤2 が理想の降下角。赤が多いと低すぎ、白が多いと高すぎ。';
  return s || '速度と高度を保ちながら滑走路へ進入しよう';
}

export const MISSIONS = [
  {
    id: 'm1', num: 1, time: 'dawn', title: 'はじまりの飛行場', en: 'The First Airfield',
    blurb: '朝焼けの滑走路から飛び立ち、海の向こうの灯台の島へ。離陸と着陸を覚えよう。',
    intro: [
      '祖父が遺した古い飛行日誌。その最初のページには、朝の飛行場から海を越えた「灯台の島」が記されていた。',
      'まずは日誌の通りに飛んでみよう。離陸して、灯台の島の滑走路に降り立つのだ。',
    ],
    start: { runway: 'home', along: -510 },
    steps: [
      {
        text: 'スロットルを上げて滑走を始めよう',
        hint: takeoffHint,
        check: (g) => g.fm.throttle >= 0.75 && (g.fm.groundSpeed || 0) > 4,
      },
      {
        text: '十分な速度で機首を上げ、離陸しよう',
        hint: takeoffHint,
        check: (g) => !g.fm.onGround && g.fm.pos.y - g.groundAt(g.fm.pos.x, g.fm.pos.z) > 40,
      },
      {
        text: '北東の「灯台の島」へ向かおう',
        hint: () => '<kbd>A</kbd>/<kbd>D</kbd> で機体を傾けると旋回できる。コンパスの ◆ を目指そう',
        target: () => ({ ...poi('lighthouse'), label: '灯台の島' }),
        check: (g) => g.discovered.has('lighthouse'),
      },
      {
        text: '灯台の島の滑走路に着陸し、停止しよう',
        hint: (g) => landingHint(g, 'lighthouse'),
        target: () => ({ x: RUNWAYS.lighthouse.x, y: RUNWAYS.lighthouse.elev, z: RUNWAYS.lighthouse.z, label: '滑走路' }),
        runway: 'lighthouse',
        check: (g) => g.stoppedOn === 'lighthouse',
      },
    ],
    side: ['海の門をくぐり抜ける', 'スカイクリスタルを探す'],
    outro: '灯台の島に到着した。日誌の次のページには、北西の山脈と「雲の海」が描かれている…',
  },
  {
    id: 'm2', num: 2, time: 'day', title: '雲海の向こう', en: 'Beyond the Sea of Clouds',
    blurb: '北西の雄大な山脈へ。雲海の下に隠された古代遺跡を探し出そう。',
    intro: [
      '日誌にはこうある。「山々を包む雲の海。その下、川の源に風の神殿が眠る」',
      '地図にない遺跡だ。目印はない。峡谷の川をさかのぼり、自分の目で見つけ出そう。',
    ],
    start: { runway: 'lighthouse', along: -340, reverse: true },
    steps: [
      {
        text: '離陸し、北西の山脈へ向かおう',
        hint: (g) => (g.fm.onGround ? takeoffHint(g) : '山脈は北西（コンパスの ◆）。雲海が見えてくるはずだ'),
        target: () => ({ ...poi('cloudsea'), label: '山脈' }),
        check: (g) => g.discovered.has('cloudsea') || g.discovered.has('canyon') || g.discovered.has('ruins'),
      },
      {
        text: '雲海の下に眠る遺跡を探そう',
        hint: (g) => {
          const r = g.resonance();
          if (r > 0.75) return '共鳴がとても強い！ 遺跡はすぐ近くだ。雲の下を探そう';
          if (r > 0.4) return '共鳴が強まっている。この先だ';
          return '日誌の手がかり：「川をさかのぼれ」。南の海岸にある峡谷の入口から川をたどろう。右上の共鳴計が近さを教えてくれる';
        },
        target: (g) => (g.discovered.has('canyon') ? null : { x: CANYON[CANYON.length - 2].x, y: 120, z: CANYON[CANYON.length - 2].z, label: '峡谷の入口？', vague: true }),
        resonance: true,
        check: (g) => g.discovered.has('ruins'),
      },
      {
        text: '山麓の滑走路に着陸して発見を記録しよう',
        hint: (g) => landingHint(g, 'foothill'),
        target: () => ({ x: RUNWAYS.foothill.x, y: RUNWAYS.foothill.elev, z: RUNWAYS.foothill.z, label: '山麓の滑走路' }),
        runway: 'foothill',
        check: (g) => g.stoppedOn === 'foothill',
      },
    ],
    side: ['双子の滝を見つける', '天嶺の頂を越える', '峡谷のクリスタル'],
    outro: '神殿の光は、夕陽と反対の空――東の海を指していた。祖父が最後に目指した場所だ。',
  },
  {
    id: 'm3', num: 3, time: 'sunset', title: '幻の島', en: 'The Phantom Isle',
    blurb: '神殿の光が示す東の海へ。霧に隠された幻の島と、秘密の滑走路を見つけよう。',
    intro: [
      '日誌の最後のページ。「光の示す先、霧の向こうに島はある。石の門をくぐり、眠れる滑走路へ」',
      '夕暮れの空に、神殿から伸びる光の帯が見える。あれを追いかけよう。',
    ],
    start: { runway: 'foothill', along: -420 },
    steps: [
      {
        text: '神殿の光が指す東の海へ飛ぼう',
        hint: (g) => (g.fm.onGround ? takeoffHint(g) : '空に伸びる金色の光の帯を追いかけよう。霧の壁が見えたら近い'),
        target: () => ({ x: FOG_BANK.x, y: 400, z: FOG_BANK.z, label: '光の先', vague: true }),
        check: (g) => g.dist(FOG_BANK.x, FOG_BANK.z) < FOG_BANK.outer,
      },
      {
        text: '霧の中に隠された島を見つけよう',
        hint: () => '霧の中では計器が頼り。高度 300m 前後を保ち、まっすぐ進もう',
        check: (g) => g.discovered.has('phantom'),
      },
      {
        text: '秘密の滑走路を探して着陸しよう',
        hint: (g) => {
          if (!g.discovered.has('secret')) return 'カルデラ（火口）の内側を探そう。外輪山の切れ目にある「石の門」から低く進入できる';
          return landingHint(g, 'secret');
        },
        target: (g) => (g.discovered.has('secret') ? { x: RUNWAYS.secret.x, y: RUNWAYS.secret.elev, z: RUNWAYS.secret.z, label: '秘密の滑走路' } : null),
        runway: 'secret',
        check: (g) => g.stoppedOn === 'secret',
      },
    ],
    side: ['浮遊岩のクリスタル'],
    outro: '滑走路の端に、見覚えのある古い機体が眠っていた。祖父の飛行機だ。――旅は、ここからまた始まる。',
    ending: true,
  },
];

export const FREE_FLIGHT = {
  id: 'free', num: 0, title: 'フリーフライト', en: 'Free Flight', time: 'golden',
  blurb: '目的なしで自由に空を飛び、世界中の発見とクリスタルを集めよう。',
  intro: ['自由に飛ぼう。地図（M）で発見した場所を確認できる。'],
  start: { runway: 'home', along: -510 },
  steps: [
    {
      text: '世界を自由に探検しよう',
      hint: (g) => (g.fm.onGround && g.fm.speed < 20 ? takeoffHint(g) : `発見 ${g.discovered.size}/${POIS.length}・クリスタル ${g.crystalsFound.size}/8。地図は <kbd>M</kbd>`),
      check: () => false,
    },
  ],
};
