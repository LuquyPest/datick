import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { confirmToast } from '../utils/confirmToast';
import { fmtDate } from '../utils/format';

const FIELD = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary transition-colors';
const BTN = 'px-3 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1';
const CARD = 'bg-surface-card border border-overlay/6 rounded-2xl p-4 sm:p-5 space-y-3';
const EMPTY = { planCodes: [], datacenters: [], maxPrice: '', label: '', channelId: '' };
const price = p => (p === null || p === undefined ? '—' : `${p.toFixed(2).replace('.', ',')} €`);
const shortName = s => s.name.split('|')[0].trim();
const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

// OVH Eco stock watch: live stock, and alerts that mention their author on Discord
export default function EcoWatch() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [channels, setChannels] = useState([]);
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/eco-watch', { params: all ? { all: 1 } : {} })
    .then(r => { setData(r.data); setError(null); })
    .catch(err => setError(err.response?.data?.error || 'Erreur'));
  useEffect(() => {
    if (!user?.ecoWatch) return undefined;
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [all, user?.ecoWatch]);
  useEffect(() => { api.get('/discord/channels').then(r => setChannels(r.data)).catch(() => {}); }, []);

  const servers = data?.servers || [];
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return servers.filter(s => (!range || s.range === range) && (!onlyAvailable || s.available)
      && words.every(w => `${s.name} ${s.planCode} ${s.cpu || ''} ${s.memory || ''}`.toLowerCase().includes(w)));
  }, [servers, search, range, onlyAvailable]);
  const nameOf = plan => { const s = servers.find(x => x.planCode === plan); return s ? shortName(s) : plan; };
  const channelName = id => { const c = channels.find(x => x.id === id); return c ? `#${c.name}` : id; };

  const reset = () => { setForm(EMPTY); setEditing(null); };
  const call = async (fn, done) => {
    setBusy(true);
    try { await fn(); if (done) toast.success(done); await load(); return true; }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; }
    finally { setBusy(false); }
  };
  const submit = async () => {
    const body = { ...form, maxPrice: form.maxPrice === '' ? null : Number(form.maxPrice), channelId: form.channelId || null };
    if (await call(() => (editing ? api.patch(`/eco-watch/alerts/${editing}`, body) : api.post('/eco-watch/alerts', body)), editing ? 'Alerte modifiée' : 'Alerte créée')) reset();
  };
  const edit = a => {
    setEditing(a.id);
    setForm({ planCodes: a.planCodes, datacenters: a.datacenters, maxPrice: a.maxPrice ?? '', label: a.label, channelId: a.channelId });
  };
  const remove = async a => {
    if (!await confirmToast('Supprimer cette alerte ?')) return;
    if (await call(() => api.delete(`/eco-watch/alerts/${a.id}`), 'Alerte supprimée') && editing === a.id) reset();
  };

  if (!user?.ecoWatch) {
    return (
      <div className="p-4 sm:p-6 max-w-xl space-y-2">
        <h1 className="text-xl font-bold text-ink-1">Veille OVH Eco</h1>
        <p className="text-sm text-ink-3">La veille OVH n'est pas activée dans cet espace.</p>
        {user?.role === 'fondateur' && <Link to="/settings?tab=fonctions" className="text-sm underline text-primary-light">L'activer dans les paramètres</Link>}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Veille OVH Eco</h1>
        <p className="text-xs text-ink-4">{data?.lastPollAt ? <>Dernière vérification : <span translate="no">{fmtDate(data.lastPollAt)}</span></> : 'Première vérification en cours (une par minute).'}</p>
        {(error || data?.lastError) && <p role="alert" className="text-xs text-red-400 mt-1">{error || data.lastError}</p>}
      </div>

      <div className="grid lg:grid-cols-5 gap-5 items-start">
        <section className={`${CARD} lg:col-span-3`}>
          <h2 className="text-sm font-semibold text-ink-2">Serveurs</h2>
          <div className="flex flex-wrap gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher un serveur" placeholder="Rechercher un serveur" className={`${FIELD} flex-1 min-w-40`} />
            <select value={range} onChange={e => setRange(e.target.value)} aria-label="Gamme" className={`${FIELD} !w-auto`}>
              <option value="">Toutes les gammes</option>
              {Object.entries(data?.ranges || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" checked={onlyAvailable} onChange={e => setOnlyAvailable(e.target.checked)} /> Disponibles seulement
            </label>
          </div>
          <ul className="divide-y divide-overlay/6 max-h-[60vh] overflow-y-auto">
            {shown.map(s => (
              <li key={s.planCode}>
                <label className="flex gap-3 py-2.5 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={form.planCodes.includes(s.planCode)} onChange={() => setForm(f => ({ ...f, planCodes: toggle(f.planCodes, s.planCode) }))} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-ink-1 font-medium" translate="no">{shortName(s)}</span>
                      {s.available && <span className="px-1.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-bold">En stock</span>}
                    </span>
                    <span className="block text-xs text-ink-4" translate="no">{[s.cpu || s.name.split('|')[1]?.trim(), s.memory].filter(Boolean).join(' · ')}</span>
                    <span className="block text-[11px] text-emerald-400" translate="no">{s.datacenters.filter(d => d.available).map(d => d.datacenter.toUpperCase()).join(' · ')}</span>
                  </span>
                  <span className="text-sm text-ink-2 tabular-nums whitespace-nowrap" translate="no">{price(s.price)}</span>
                </label>
              </li>
            ))}
          </ul>
          {data && !shown.length && <p className="text-sm text-ink-4">Aucun serveur à afficher.</p>}
        </section>

        <div className="lg:col-span-2 space-y-5">
          <section className={CARD}>
            <h2 className="text-sm font-semibold text-ink-2">{editing ? 'Modifier l\'alerte' : 'Nouvelle alerte'}</h2>
            {!form.planCodes.length && <p className="text-xs text-ink-4">Coche un ou plusieurs serveurs dans la liste.</p>}
            <div className="flex flex-wrap gap-1.5">
              {form.planCodes.map(p => (
                <button key={p} type="button" onClick={() => setForm(f => ({ ...f, planCodes: toggle(f.planCodes, p) }))}
                  className="px-2 py-1 rounded-lg bg-primary/15 text-primary-light text-xs" translate="no">{nameOf(p)} ×</button>
              ))}
            </div>
            <fieldset>
              <legend className="text-xs text-ink-3 mb-1.5">Datacenters (aucun coché = tous)</legend>
              <div className="flex flex-wrap gap-1.5">
                {(data?.datacenters || []).map(d => (
                  <button key={d.code} type="button" aria-pressed={form.datacenters.includes(d.code)} translate="no"
                    onClick={() => setForm(f => ({ ...f, datacenters: toggle(f.datacenters, d.code) }))}
                    className={`px-2 py-1 rounded-lg text-xs border ${form.datacenters.includes(d.code) ? 'bg-primary/15 border-primary/40 text-primary-light' : 'bg-surface border-overlay/8 text-ink-3'}`}>{d.label}</button>
                ))}
              </div>
            </fieldset>
            <input type="number" min="0" step="0.01" value={form.maxPrice} onChange={e => setForm(f => ({ ...f, maxPrice: e.target.value }))}
              aria-label="Prix maximum HT par mois (€)" placeholder="Prix maximum HT par mois (€)" className={FIELD} />
            <input value={form.label} maxLength={80} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} aria-label="Nom de l'alerte" placeholder="Nom de l'alerte" className={FIELD} />
            <select value={form.channelId} onChange={e => setForm(f => ({ ...f, channelId: e.target.value }))} aria-label="Salon où te mentionner" className={FIELD}>
              <option value="">{data?.defaultChannelId ? 'Salon par défaut' : 'Choisis un salon'}</option>
              {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy || !form.planCodes.length} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
                {editing ? 'Enregistrer' : 'Créer l\'alerte'}
              </button>
              {editing && <button onClick={reset} className="px-4 py-2 rounded-lg text-sm text-ink-3 hover:text-ink-1">Annuler</button>}
            </div>
          </section>

          <section className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-2">Alertes</h2>
              {data?.canManage && (
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Voir celles de tout le serveur
                </label>
              )}
            </div>
            {data && !data.alerts.length && <p className="text-sm text-ink-4">Aucune alerte.</p>}
            <ul className="space-y-3">
              {(data?.alerts || []).map(a => (
                <li key={a.id} className={`border border-overlay/8 rounded-xl p-3 space-y-2 ${a.enabled ? '' : 'opacity-60'}`}>
                  <p className="text-sm text-ink-1 font-medium" translate="no">#{a.id} {a.label || a.planCodes.map(nameOf).join(', ')}</p>
                  <p className="text-xs text-ink-4" translate="no">
                    {[a.datacenters.map(d => d.toUpperCase()).join(' · '), a.maxPrice !== null && `≤ ${price(a.maxPrice)}`, channelName(a.channelId), all && a.username].filter(Boolean).join(' · ')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button className={BTN} disabled={busy} onClick={() => call(() => api.patch(`/eco-watch/alerts/${a.id}`, { enabled: !a.enabled }))}>{a.enabled ? 'Mettre en pause' : 'Réactiver'}</button>
                    <button className={BTN} onClick={() => edit(a)}>Modifier</button>
                    <button className={BTN} disabled={busy} onClick={() => call(() => api.post(`/eco-watch/alerts/${a.id}/test`), 'Message de test envoyé')}>Tester</button>
                    <button className={BTN} disabled={busy} onClick={() => remove(a)}>Supprimer</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
