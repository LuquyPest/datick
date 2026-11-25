// Public OVHcloud API (no key) used by eco.ovhcloud.com: Eco catalogue and availabilities.
// Taken from the « OVH Eco Watch » bot.
const ENDPOINT = 'https://eu.api.ovh.com/v1';
const SUBSIDIARY = 'FR';
const ECO_URL = 'https://eco.ovhcloud.com/fr/';
const UNAVAILABLE = new Set(['unavailable', 'comingSoon', 'unknown', '']);

const DATACENTERS = {
  gra: ['Gravelines', '🇫🇷'], rbx: ['Roubaix', '🇫🇷'], sbg: ['Strasbourg', '🇫🇷'], par: ['Paris', '🇫🇷'],
  bhs: ['Beauharnois', '🇨🇦'], fra: ['Francfort', '🇩🇪'], lim: ['Limburg', '🇩🇪'], waw: ['Varsovie', '🇵🇱'],
  lon: ['Londres', '🇬🇧'], eri: ['Erith', '🇬🇧'], mad: ['Madrid', '🇪🇸'], mil: ['Milan', '🇮🇹'],
  sgp: ['Singapour', '🇸🇬'], syd: ['Sydney', '🇦🇺'], ynm: ['Mumbai', '🇮🇳'], hil: ['Hillsboro', '🇺🇸'],
  vin: ['Vint Hill', '🇺🇸'], tor: ['Toronto', '🇨🇦'],
};
const RANGE_LABELS = { kimsufi: 'Kimsufi', soyoustart: 'So you Start', rise: 'Rise', autre: 'Autre' };

function dcLabel(code) {
  const dc = DATACENTERS[String(code).replace(/-.*$/, '').toLowerCase()];
  return dc ? `${dc[1]} ${dc[0]}` : String(code).toUpperCase();
}
const isAvailable = status => !UNAVAILABLE.has(String(status ?? ''));
const availabilityLabel = status => { const m = /^(\d+)H/i.exec(String(status)); return m ? `~${m[1]} h` : String(status); };

// "ram-64g-noecc-2133" -> "64 Go RAM"
function prettyMemory(memory) {
  const m = /ram-(\d+)g/i.exec(memory || '');
  if (!m) return memory || '';
  return `${m[1]} Go RAM${!/noecc/i.test(memory) && /ecc/i.test(memory) ? ' ECC' : ''}`;
}
// "softraid-2x2000sa" -> "2×2 To HDD (soft RAID)"
function prettyStorage(storage) {
  const m = /(\d+)x(\d+)(ssd|nvme|sa|sas|hdd)?/i.exec(storage || '');
  if (!m) return storage || '';
  const [, count, size, kindRaw = ''] = m;
  const sizeLabel = Number(size) >= 1000 ? `${+(Number(size) / 1000).toFixed(1)} To` : `${size} Go`;
  const kind = { ssd: 'SSD', nvme: 'NVMe', sa: 'HDD', sas: 'HDD SAS', hdd: 'HDD' }[kindRaw.toLowerCase()] || '';
  const raid = /hybridsoftraid/i.test(storage) ? ' (RAID hybride)' : /softraid/i.test(storage) ? ' (soft RAID)' : '';
  return `${count}×${sizeLabel} ${kind}${raid}`.replace(/\s+/g, ' ').trim();
}

function guessRange(name, planCode) {
  const n = `${name} ${planCode}`.toLowerCase();
  if (/\bks-|kimsufi|ska\d/.test(n)) return 'kimsufi';
  if (/\bsys-|soyoustart|sys\d/.test(n)) return 'soyoustart';
  if (/\brise-|rise\d/.test(n)) return 'rise';
  return 'autre';
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'eco-watch/1.0' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`API OVH : réponse ${res.status}`);
  return res.json();
}

// Monthly price before tax (OVH prices are in 1e-8 of the currency)
function monthlyPrice(plan) {
  const monthly = (plan.pricings || []).filter(p => p.interval === 1 && p.intervalUnit === 'month');
  const pick = monthly.find(p => (p.capacities || []).includes('renew') && (p.mode === 'default' || !p.mode))
    || monthly.find(p => p.mode === 'default') || monthly[0];
  return pick && typeof pick.price === 'number' ? Math.round(pick.price / 1e6) / 100 : null;
}

// → { planCode: { planCode, name, range, price, cpu, cores, threads, memory } }
async function fetchCatalog() {
  const catalog = await getJson(`${ENDPOINT}/order/catalog/public/eco?ovhSubsidiary=${SUBSIDIARY}`);
  const plans = {};
  for (const plan of catalog.plans || []) {
    if (!plan.planCode) continue;
    const name = plan.invoiceName || plan.planCode;
    const range = String(plan.blobs?.commercial?.range || '').toLowerCase();
    const tech = plan.blobs?.technical || {};
    const cpu = tech.server?.cpu || {};
    plans[plan.planCode] = {
      planCode: plan.planCode, name, range: Object.hasOwn(RANGE_LABELS, range) ? range : guessRange(name, plan.planCode),
      price: monthlyPrice(plan), cpu: [cpu.brand, cpu.model].filter(Boolean).join(' ') || null,
      cores: cpu.cores ?? null, threads: cpu.threads ?? null, memory: tech.memory?.size ? `${tech.memory.size} Go` : null,
    };
  }
  if (!Object.keys(plans).length) throw new Error('Catalogue Eco vide : réponse OVH inattendue');
  return plans;
}

// → [{ fqn, planCode, memory, storage, datacenters: [{ datacenter, availability }] }]
async function fetchAvailabilities() {
  const data = await getJson(`${ENDPOINT}/dedicated/server/datacenter/availabilities`);
  if (!Array.isArray(data)) throw new Error('Réponse de disponibilités inattendue');
  return data;
}

module.exports = { ECO_URL, RANGE_LABELS, dcLabel, isAvailable, availabilityLabel, prettyMemory, prettyStorage, fetchCatalog, fetchAvailabilities };
