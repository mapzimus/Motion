// What a live aircraft is (for its map silhouette) and whether it is
// squawking an emergency. Pure and DOM-free so it can be unit tested.
//
// Icon choice comes from the ADS-B emitter category the aircraft broadcasts:
//   A1–A2 light/small · A3–A6 large, heavy, high-performance · A7 rotorcraft
//   B*/C*/D* gliders, balloons, drones, ground vehicles, reserved -> "other".
// Many aircraft send no category (A0 or nothing); then the ICAO type code
// decides, and an unrecognized type falls back to the airliner silhouette.

export const PLANE_ICON_BY_KIND = {
  airliner: 'icon-plane',
  light: 'icon-plane-light',
  heli: 'icon-plane-heli',
  other: 'icon-plane-other',
};

// ICAO type designators of helicopters common in New England (medevac, news,
// police, utility, tour and training).
const HELICOPTER_TYPES = /^(R22|R44|R66|EC\d\d|H125|H130|H135|H145|H155|H160|H175|AS\d\d|AS3B|B06T?|B407|B412|B427|B429|B430|B505|B212|S76|S92|H60|UH1|A109|A119|A139|A169|A189|AW09|BK17|MD52|MD60|H500|H269|EN28|EN48|S300|B47G)$/;
// Piston and light turboprop fixed-wing types (Cessna, Piper, Cirrus,
// Beechcraft, Mooney, Diamond, Van's, Cub, plus the island-hopper twins and
// singles Cape Air and the Maine air taxis fly).
const LIGHT_TYPES = /^(C1[5-9]\d|C2[01]\d|C3[14]0|C40\d|C77R|C208|P28[A-Z]|P32[RT]|PA\d\d|P46T|P212|SR2[02]|S22T|BE(2[34]|3[356]|55|58|76|77)|M20[A-Z]|DA[2-6]\d|AA[15]|RV\d{1,2}|GLAS|J3|BN2P|PC12|TBM\d|KODI)$/;

export function aircraftKind(category, typeCode) {
  const cat = String(category ?? '').trim().toUpperCase();
  if (cat === 'A1' || cat === 'A2') return 'light';
  if (cat === 'A3' || cat === 'A4' || cat === 'A5' || cat === 'A6') return 'airliner';
  if (cat === 'A7') return 'heli';
  if (cat && cat !== 'A0') return 'other';
  const type = String(typeCode ?? '').trim().toUpperCase();
  if (!type) return 'other';
  if (HELICOPTER_TYPES.test(type)) return 'heli';
  if (LIGHT_TYPES.test(type)) return 'light';
  return 'airliner';
}

export const planeIcon = (category, typeCode) => PLANE_ICON_BY_KIND[aircraftKind(category, typeCode)];

const SQUAWK_MEANING = {
  7500: 'unlawful interference',
  7600: 'radio failure',
  7700: 'general emergency',
};
// readsb's decoded ADS-B emergency/priority status.
const STATUS_MEANING = {
  general: 'general emergency',
  lifeguard: 'lifeguard / medical priority',
  minfuel: 'minimum fuel',
  nordo: 'radio failure',
  unlawful: 'unlawful interference',
  downed: 'aircraft downed',
  reserved: 'emergency',
};

// One plain line for the trip card, or '' when nothing is wrong.
//   "Squawking 7700 · general emergency", "Emergency status · minimum fuel"
export function emergencyLine(squawk, emergency) {
  const code = String(squawk ?? '').trim();
  const state = String(emergency ?? '').trim().toLowerCase();
  const stateMeaning = state && state !== 'none' ? (STATUS_MEANING[state] ?? 'emergency') : '';
  if (SQUAWK_MEANING[code]) return `Squawking ${code} · ${stateMeaning || SQUAWK_MEANING[code]}`;
  if (stateMeaning) return `Emergency status · ${stateMeaning}`;
  return '';
}

// "climbing" / "descending" once the vertical rate is clearly not level flight.
export function verticalTrend(feetPerMinute) {
  if (!Number.isFinite(feetPerMinute) || Math.abs(feetPerMinute) < 300) return '';
  return feetPerMinute > 0 ? 'climbing' : 'descending';
}
