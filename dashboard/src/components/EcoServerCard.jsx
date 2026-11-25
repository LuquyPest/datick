import React, { useState } from 'react';
import { ExternalLink, ChevronDown } from 'lucide-react';

export const price = p => (p === null || p === undefined ? '—' : `${p.toFixed(2).replace('.', ',')} €`);
export const shortName = s => s.name.split('|')[0].trim();
const USAGES = {
  hosting: 'Hébergement', gaming: 'Jeux', bdd: 'Bases de données', email: 'E-mail', 'dev-env': 'Développement',
  'data-storage': 'Stockage de données', 'archive-backup-recovery': 'Archives et sauvegardes', vdi: 'Bureaux virtuels', hpc: 'Calcul intensif',
  'confidential-computing': 'Informatique confidentielle', 'virtualisation-containerisation-orchestration': 'Virtualisation et conteneurs', 'limited-edition': 'Édition limitée',
};
const OPTIONS = { memory: 'Mémoire', storage: 'Stockage', 'system-storage': 'Disques système', bandwidth: 'Bande passante publique', vrack: 'Réseau privé (vRack)', gpu: 'Carte graphique' };

function Spec({ label, value, raw }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-overlay/4">
      <dt className="text-ink-4">{label}</dt>
      <dd className="text-ink-1 text-right" translate={raw ? 'no' : undefined}>{value}</dd>
    </div>
  );
}

// One OVH Eco server: illustration of its range, main specs, order link, and the full sheet on demand
export default function EcoServerCard({ server: s, range, dcLabel, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const [noImage, setNoImage] = useState(false);
  const stock = s.datacenters.filter(d => d.available);
  const cores = s.cores ? `${s.cores} / ${s.threads ?? s.cores}` : null;
  const ghz = [s.frequency && `${s.frequency} GHz`, s.boost && `boost ${s.boost} GHz`].filter(Boolean).join(' · ');
  const first = family => s.options?.[family]?.find(o => o.default)?.label;

  return (
    <li className={`bg-surface-card border rounded-2xl p-4 space-y-3 ${selected ? 'border-primary/60' : 'border-overlay/6'}`}>
      <div className="flex flex-wrap gap-4">
        <div className="w-28 shrink-0">
          {!noImage && s.range !== 'autre' && (
            <img src={`/api/eco-watch/images/${s.range}`} alt={`Illustration de la gamme ${range}`} loading="lazy" onError={() => setNoImage(true)} className="w-28 rounded-xl bg-white" />
          )}
          <p className="text-[11px] text-ink-4 text-center mt-1" translate="no">{range}</p>
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-ink-1" translate="no">{shortName(s)}</h3>
            <span className={`px-1.5 rounded text-[10px] font-bold ${s.available ? 'bg-emerald-500/15 text-emerald-400' : 'bg-overlay/6 text-ink-4'}`}>{s.available ? 'En stock' : 'Rupture'}</span>
          </div>
          <p className="text-sm text-ink-2" translate="no">{s.cpu || '—'}</p>
          <p className="text-xs text-ink-3">{cores && <span>{`${cores} cœurs/threads`}</span>}{cores && ghz && ' · '}<span translate="no">{ghz}</span></p>
          <p className="text-xs text-ink-3" translate="no">{[first('memory'), first('storage'), first('bandwidth')].filter(Boolean).join(' — ')}</p>
          {!!stock.length && <p className="text-[11px] text-emerald-400" translate="no">{stock.map(d => dcLabel(d.datacenter)).join(' · ')}</p>}
        </div>
        <div className="text-right space-y-1 ml-auto">
          <p className="text-lg font-bold text-ink-1 tabular-nums" translate="no">{price(s.price)}</p>
          <p className="text-[11px] text-ink-4">HT par mois</p>
          {s.priceTax != null && <p className="text-[11px] text-ink-4">{`${price(s.priceTax)} TTC`}</p>}
          <a href={s.url || 'https://eco.ovhcloud.com/fr/'} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold">
            {s.productPage ? 'Commander sur OVH' : 'Voir la gamme sur OVH'} <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={selected} onChange={onSelect} /> Surveiller ce serveur
        </label>
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-xs text-primary-light">
          Fiche complète <ChevronDown size={13} aria-hidden="true" className={open ? 'rotate-180' : ''} />
        </button>
      </div>

      {open && (
        <div className="space-y-4 text-xs border-t border-overlay/6 pt-3">
          <dl className="grid sm:grid-cols-2 gap-x-6">
            <Spec label="Processeur" value={s.cpu} raw />
            <Spec label="Cœurs / threads" value={cores} raw />
            <Spec label="Fréquence" value={ghz} raw />
            <Spec label="Score CPU" value={s.cpuScore} raw />
            <Spec label="Châssis" value={s.frame} raw />
            <Spec label="Double alimentation" value={s.frame ? (s.dualPower ? 'Oui' : 'Non') : null} />
            <Spec label="Disponibilité garantie (SLA)" value={s.sla && `${s.sla} %`} raw />
            <Spec label="Anti-DDoS" value={s.antiDdos} raw />
            <Spec label="Année de sortie" value={s.releaseYear} raw />
            <Spec label="Référence" value={s.planCode} raw />
            <Spec label="Frais d'installation HT" value={s.setup != null ? price(s.setup) : null} raw />
            <Spec label="Par mois avec engagement 12 mois (payé d'avance)" value={s.price12 != null ? price(s.price12) : null} raw />
            <Spec label="Par mois avec engagement 24 mois (payé d'avance)" value={s.price24 != null ? price(s.price24) : null} raw />
          </dl>
          {!!s.usages?.length && (
            <div className="flex flex-wrap gap-1.5">{s.usages.map(u => <span key={u} className="px-2 py-0.5 rounded-md bg-overlay/6 text-ink-2">{USAGES[u] || u}</span>)}</div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            {Object.entries(OPTIONS).filter(([k]) => s.options?.[k]?.length).map(([k, title]) => (
              <div key={k}>
                <h4 className="font-semibold text-ink-2 mb-1">{title}</h4>
                <ul className="space-y-0.5">
                  {s.options[k].map(o => (
                    <li key={o.code} className="flex justify-between gap-3">
                      <span className="text-ink-1" translate="no">{o.label}</span>
                      <span className="text-ink-4 whitespace-nowrap">{o.price ? <span translate="no">+ {price(o.price)}</span> : 'inclus'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <h4 className="font-semibold text-ink-2 mb-1">Configurations et stock par datacenter</h4>
            <table className="w-full min-w-[32rem]">
              <thead><tr className="text-left text-ink-4"><th className="font-medium py-1">Configuration</th><th className="font-medium">Prix HT</th><th className="font-medium">Datacenters</th></tr></thead>
              <tbody>
                {s.variants.map((v, i) => (
                  <tr key={i} className="border-t border-overlay/6 align-top">
                    <td className="py-1.5 pr-3 text-ink-1" translate="no">{v.memoryLabel || v.memory}<br />{v.storageLabel || v.storage}</td>
                    <td className="py-1.5 pr-3 text-ink-1 whitespace-nowrap tabular-nums" translate="no">{price(v.price)}</td>
                    <td className="py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {v.datacenters.map(d => (
                          <span key={d.datacenter} translate="no" title={dcLabel(d.datacenter)}
                            className={`px-1.5 rounded ${d.available ? 'bg-emerald-500/15 text-emerald-400' : 'bg-overlay/4 text-ink-4'}`}>
                            {d.datacenter.toUpperCase()}{d.available ? ` ~${String(d.availability).replace(/-.*$/, '').replace(/H$/i, ' h')}` : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </li>
  );
}
