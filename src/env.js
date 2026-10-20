// Time-of-day presets. Each mission picks one; free flight can choose any.
import * as THREE from 'three';

function sunDir(elevDeg, azDeg) {
  const e = THREE.MathUtils.degToRad(elevDeg), a = THREE.MathUtils.degToRad(azDeg);
  // azimuth: clockwise from north (-Z)
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

export const TIMES = {
  dawn: {
    label: '朝', sun: sunDir(9, 105),
    zenith: '#3f6fb3', horizon: '#f2c7a4', ground: '#9aa7b8', glow: '#ffb070',
    sunColor: '#ffd7a8', sunIntensity: 2.6, hemiSky: '#bcd2f0', hemiGround: '#6b5a48', hemiIntensity: 0.9,
    fogDensity: 0.000072, water: { deep: '#1b4467', shallow: '#3fa6a6' }, cloud: '#ffe9dc', cloudShade: '#b6a7b8',
  },
  day: {
    label: '昼', sun: sunDir(52, 200),
    zenith: '#2f6fd0', horizon: '#bcd8f0', ground: '#93a9bf', glow: '#fff2d0',
    sunColor: '#fff4e0', sunIntensity: 3.2, hemiSky: '#cfe3ff', hemiGround: '#5a6a48', hemiIntensity: 1.05,
    fogDensity: 0.00006, water: { deep: '#123f6e', shallow: '#2fb7b0' }, cloud: '#ffffff', cloudShade: '#aab8cc',
  },
  golden: {
    label: '夕方', sun: sunDir(16, 250),
    zenith: '#3a62a8', horizon: '#f5d3a0', ground: '#a29a90', glow: '#ffc070',
    sunColor: '#ffd49a', sunIntensity: 2.9, hemiSky: '#c8d4ef', hemiGround: '#6a5642', hemiIntensity: 0.95,
    fogDensity: 0.000066, water: { deep: '#17406a', shallow: '#3a9fa2' }, cloud: '#fff0dc', cloudShade: '#b0a4b4',
  },
  sunset: {
    label: '夕暮れ', sun: sunDir(3.5, 262),
    zenith: '#2a3a78', horizon: '#ff9e6a', ground: '#7a6a78', glow: '#ff7a3a',
    sunColor: '#ffab6a', sunIntensity: 2.4, hemiSky: '#9aa2d8', hemiGround: '#5a3f3a', hemiIntensity: 0.75,
    fogDensity: 0.000078, water: { deep: '#1a2f55', shallow: '#3a7a8e' }, cloud: '#ffc8a8', cloudShade: '#7a6890',
  },
};

export function applyColor(c) {
  return new THREE.Color(c);
}
