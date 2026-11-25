# OVH Eco stock watch

Mentions a member on Discord as soon as an OVH Eco server (Kimsufi, So you Start, Rise) they wait for is back in stock. The feature is **off by default**.

## Turn it on

**Settings → Features → OVH Eco stock watch**, then *Save*. You may pick a default channel. The space must be linked to a Discord server.

The `/dispo` and `/alerte` commands then appear on that server, and the **OVH watch** page in the dashboard menu. Turning it off removes them and nothing more is sent; alerts are kept.

## Discord commands

| Command | What it does |
|---|---|
| `/dispo [gamme]` | Servers in stock |
| `/alerte ajouter serveur [datacenter] [prix_max] [salon]` | Create an alert |
| `/alerte liste` | Your alerts |
| `/alerte pause id` | Pause or resume |
| `/alerte supprimer id` | Delete |

Replies and notifications are in French.

## Dashboard

The **OVH watch** page shows the stock and lets you create an alert on several servers at once, edit and test it. Everyone manages their own alerts; founders (and the settings permission) see the whole server's. An account linked to Discord is needed to be mentioned. Members outside the staff use the commands.

## How it works

- One reading of OVH's public API per minute, no key, only when at least one space has turned the watch on.
- Only what **becomes** available is announced. The first reading announces nothing, nor does one after more than 24 h without reading.
- At most one notification per alert and server every 15 minutes; one message per channel.
- 25 alerts per person. Outside the default channel, you must be able to write in the chosen one.
