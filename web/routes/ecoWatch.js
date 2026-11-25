// OVH Eco Watch (utils/ecoWatch.js): stock and alerts. Staff see and manage their own alerts;
// founders and manage_settings see all. Refused while the feature is off in the space.
const express = require('express');
const router = express.Router();
const E = require('../../utils/ecoWatch');
const { dcLabel, RANGE_LABELS, rangeImage } = require('../../utils/ecoWatchOvh');
const { fetchGuildChannel } = require('../../utils/discordGuard');

const canManage = req => req.userIsFondateur || !!req.userPermissions?.has('manage_settings');
const ctx = req => ({ client: req.app.locals.client, guildId: req.guildId, db: req.guildDb, userId: req.session.user.id });

router.use(async (req, res, next) => {
  try {
    if (!(await E.settings(req.guildDb)).enabled) return res.status(403).json({ error: 'La veille OVH n\'est pas activée dans cet espace' });
    next();
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const all = req.query.all === '1' && canManage(req);
    const [snap, alerts, cfg] = await Promise.all([E.readSnapshot(), E.listAlerts(req.guildDb, all ? null : req.session.user.id), E.settings(req.guildDb)]);
    res.json({
      ...snap, datacenters: snap.datacenters.map(code => ({ code, label: dcLabel(code) })), ranges: RANGE_LABELS,
      alerts, defaultChannelId: cfg.channelId, canManage: canManage(req), maxAlerts: E.MAX_ALERTS_PER_USER,
    });
  } catch (err) { next(err); }
});

// The range illustrations of eco.ovhcloud.com, relayed: the site needs a cookie the browser would not keep
router.get('/images/:range', async (req, res) => {
  const image = await rangeImage(req.params.range).catch(() => null);
  if (!image) return res.status(404).json({ error: 'Image indisponible' });
  res.set('Cache-Control', 'private, max-age=86400').type('png').send(image);
});

router.post('/alerts', async (req, res, next) => {
  try {
    const r = await E.createAlert(ctx(req), req.session.user, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json(r);
  } catch (err) { next(err); }
});

// The alert, if it is the person's own (or they manage the settings)
router.param('id', async (req, res, next, id) => {
  try {
    const alert = await E.getAlert(req.guildDb, id);
    if (!alert || (alert.userId !== req.session.user.id && !canManage(req))) return res.status(404).json({ error: 'Alerte introuvable' });
    req.ecoAlert = alert;
    next();
  } catch (err) { next(err); }
});

router.patch('/alerts/:id', async (req, res, next) => {
  try {
    const r = await E.updateAlert(ctx(req), req.ecoAlert, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

router.delete('/alerts/:id', async (req, res, next) => {
  try { await E.removeAlert(req.guildDb, req.ecoAlert.id); res.json({ ok: true }); } catch (err) { next(err); }
});

router.post('/alerts/:id/test', async (req, res, next) => {
  try {
    if (!(await require('../../utils/rateLimit').allowBurst(`test:eco:${req.guildId}:${req.session.user.id}`, 5, 10 * 60 * 1000))) {
      return res.status(429).json({ error: 'Cinq essais au plus toutes les 10 minutes' });
    }
    if (!(await fetchGuildChannel(req.app.locals.client, req.guildId, req.ecoAlert.channelId))) return res.status(400).json({ error: 'Salon introuvable ou inaccessible au bot' });
    await E.sendTest(req.app.locals.client, req.guildId, req.ecoAlert);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
