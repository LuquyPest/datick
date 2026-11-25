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

// OVH prices are in 1e-8 of the currency
const euros = v => Math.round(v / 1e6) / 100;
const monthly = (offer, mode = 'default', months = 1) => (offer.pricings || [])
  .find(p => p.mode === mode && p.interval === months && p.intervalUnit === 'month' && (p.capacities || []).includes('renew'));
const priceOf = (offer, mode, months) => { const p = monthly(offer, mode, months); return p ? euros(p.price) : null; };
const size = gb => (gb >= 1000 ? `${+(gb / 1000).toFixed(2)} To` : `${gb} Go`);

// Full wording of an option, from the technical sheet of its product
function optionLabel(family, tech, fallback) {
  if (family === 'memory' && tech.memory?.size) {
    const m = tech.memory;
    return [`${m.size} Go`, m.ramType, m.frequency && `${m.frequency} MHz`, m.ecc ? 'ECC' : 'non ECC'].filter(Boolean).join(' ');
  }
  if ((family === 'storage' || family === 'system-storage') && tech.storage?.disks?.length) {
    const disks = tech.storage.disks.map(d => [`${d.number}×${size(d.capacity)}`, d.technology, d.interface !== d.technology && d.interface, d.specs, d.usage === 'os' && '(système)'].filter(Boolean).join(' '));
    return [disks.join(' + '), tech.storage.raid, tech.storage.hotSwap && 'remplaçable à chaud'].filter(Boolean).join(' · ');
  }
  const net = tech[family === 'vrack' ? 'vrack' : 'bandwidth'];
  if ((family === 'bandwidth' || family === 'vrack') && net?.level) {
    return `${net.level >= 1000 ? `${net.level / 1000} Gbit/s` : `${net.level} Mbit/s`}${net.guaranteed ? ' garantis' : ''}`;
  }
  if (family === 'gpu' && tech.gpu) return [tech.gpu.number > 1 && `${tech.gpu.number}×`, tech.gpu.brand, tech.gpu.model, tech.gpu.memory?.size && `${tech.gpu.memory.size} Go`].filter(Boolean).join(' ');
  return fallback;
}

const OPTION_FAMILIES = ['memory', 'storage', 'system-storage', 'bandwidth', 'vrack', 'gpu']; // licences are left out

// Full sheet of every plan of the catalogue (technical data: on the plan's product and on its add-ons)
function parseCatalog(catalog) {
  const products = new Map((catalog.products || []).map(p => [p.name, p.blobs?.technical || {}]));
  const addons = new Map((catalog.addons || []).map(a => [a.planCode, a]));
  const plans = {};
  for (const plan of catalog.plans || []) {
    if (!plan.planCode) continue;
    const tech = products.get(plan.product) || {};
    const cpu = tech.server?.cpu || {};
    const name = plan.invoiceName || plan.planCode;
    const range = String(tech.server?.range || '').toLowerCase().replace(/[^a-z]/g, '');
    const features = Object.fromEntries((plan.blobs?.commercial?.features || []).map(f => [f.name, f.value]));
    const options = {};
    for (const family of plan.addonFamilies || []) {
      if (!OPTION_FAMILIES.includes(family.name)) continue;
      options[family.name] = (family.addons || []).filter(code => addons.has(code)).map(code => {
        const addon = addons.get(code);
        return { code, label: optionLabel(family.name, products.get(addon.product) || {}, addon.invoiceName || code), price: priceOf(addon) ?? 0, default: code === family.default };
      }).sort((x, y) => x.price - y.price);
    }
    const base = monthly(plan);
    const setup = (plan.pricings || []).find(p => p.mode === 'default' && p.interval === 0 && (p.capacities || []).includes('installation'));
    const committed = months => { const total = priceOf(plan, `upfront${months}`, months); return total === null ? null : Math.round(total / months * 100) / 100; };
    plans[plan.planCode] = {
      planCode: plan.planCode, name, range: Object.hasOwn(RANGE_LABELS, range) ? range : guessRange(name, plan.planCode),
      price: base ? euros(base.price) : null, priceTax: base ? euros(base.price + (base.tax || 0)) : null,
      setup: setup ? euros(setup.price) : null, price12: committed(12), price24: committed(24),
      cpu: [cpu.number > 1 && `${cpu.number}×`, cpu.brand, cpu.model].filter(Boolean).join(' ') || name.split('|')[1]?.trim() || null,
      cores: cpu.cores ?? null, threads: cpu.threads ?? null, frequency: cpu.frequency ?? null, boost: cpu.boost ?? null, cpuScore: cpu.score ?? null,
      frame: [tech.server?.frame?.model, tech.server?.frame?.size].filter(Boolean).join(' ') || null,
      dualPower: !!tech.server?.frame?.dualPowerSupply, sla: tech.server?.services?.sla ?? null, antiDdos: tech.server?.services?.antiddos || null,
      releaseYear: features['release-year'] || null, usages: String(features['baremetal-server-usecases'] || '').split(',').filter(Boolean),
      memory: options.memory?.find(o => o.default)?.label || null, options,
    };
  }
  if (!Object.keys(plans).length) throw new Error('Catalogue Eco vide : réponse OVH inattendue');
  return plans;
}

// Option named by an availability row (« ram-16g-… » → « ram-16g-…-<plan> »)
const rowOption = (plan, family, key) => (key ? plan.options?.[family]?.find(o => o.code === key || o.code.startsWith(`${key}-`)) || null : null);

async function fetchCatalog() {
  return parseCatalog(await getJson(`${ENDPOINT}/order/catalog/public/eco?ovhSubsidiary=${SUBSIDIARY}`));
}

// eco.ovhcloud.com answers 307 until it gets back the cookie it sets: followed by hand
async function fetchSite(url) {
  const jar = new Map();
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; eco-watch/1.0)', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    if (res.status < 300 || res.status >= 400) {
      if (!res.ok) throw new Error(`Site OVH : réponse ${res.status}`);
      return res;
    }
    for (const c of res.headers.getSetCookie()) { const [k, ...v] = c.split(';')[0].split('='); jar.set(k, v.join('=')); }
    target = new URL(res.headers.get('location'), target).toString();
    if (new URL(target).origin !== new URL(url).origin) throw new Error('Site OVH : redirection inattendue');
  }
  throw new Error('Site OVH : trop de redirections');
}

// Official product pages, read from the site's home page: { slug: url }. Never guessed
function parseLinks(html) {
  const links = {};
  for (const m of html.matchAll(/https:\/\/eco\.ovhcloud\.com\/fr\/(?:kimsufi|soyoustart|rise)\/([a-z0-9-]+)\//g)) links[m[1]] = m[0];
  return links;
}
const fetchLinks = async () => parseLinks(await (await fetchSite(ECO_URL)).text());

// The product page of the model, else the page of its range
function productLink(plan, links) {
  const slug = plan.name.split('|')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (links[slug]) return { url: links[slug], productPage: true };
  return { url: plan.range === 'autre' ? ECO_URL : `${ECO_URL}${plan.range}/`, productPage: false };
}

// OVH only publishes one illustration per range (none per server)
const IMAGE_RANGES = ['kimsufi', 'soyoustart', 'rise'];
const images = new Map();
async function rangeImage(range) {
  if (!IMAGE_RANGES.includes(range)) return null;
  if (!images.has(range)) {
    const res = await fetchSite(`https://eco.ovhcloud.com/sites/default/files/styles/large_screens_1x/public/2024-07/1200x800_${range}.png`);
    const body = Buffer.from(await res.arrayBuffer());
    if (res.headers.get('content-type') !== 'image/png' || body.length > 2_000_000) throw new Error('Image OVH inattendue');
    images.set(range, body);
  }
  return images.get(range);
}

// → [{ fqn, planCode, memory, storage, datacenters: [{ datacenter, availability }] }]
async function fetchAvailabilities() {
  const data = await getJson(`${ENDPOINT}/dedicated/server/datacenter/availabilities`);
  if (!Array.isArray(data)) throw new Error('Réponse de disponibilités inattendue');
  return data;
}

module.exports = { ECO_URL, RANGE_LABELS, dcLabel, isAvailable, availabilityLabel, prettyMemory, prettyStorage, fetchCatalog, fetchAvailabilities,
  parseCatalog, rowOption, fetchLinks, parseLinks, productLink, rangeImage };
