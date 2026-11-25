# Veille des stocks OVH Eco

Mentionne un membre sur Discord dès qu'un serveur OVH Eco (Kimsufi, So you Start, Rise) qu'il attend est de nouveau en stock. La fonction est **désactivée par défaut**.

## Activer

**Paramètres → Fonctionnalités → Veille des stocks OVH Eco**, puis *Sauvegarder*. Tu peux choisir un salon par défaut. L'espace doit être relié à un serveur Discord.

Les commandes `/dispo` et `/alerte` apparaissent alors sur ce serveur, et la page **Veille OVH** dans le menu du dashboard. En désactivant, tout disparaît et plus rien n'est envoyé ; les alertes sont gardées.

## Commandes Discord

| Commande | Rôle |
|---|---|
| `/dispo [gamme]` | Serveurs en stock |
| `/alerte ajouter serveur [datacenter] [prix_max] [salon]` | Créer une alerte |
| `/alerte liste` | Ses alertes |
| `/alerte pause id` | Mettre en pause ou réactiver |
| `/alerte supprimer id` | Supprimer |

Les réponses et les notifications sont en français.

## Dashboard

La page **Veille OVH** montre le stock et permet de créer une alerte pour plusieurs serveurs à la fois, de la modifier et de la tester. Chacun gère ses alertes ; les fondateurs (et la permission de gestion des paramètres) voient celles de tout le serveur. Il faut un compte relié à Discord pour être mentionné. Les membres hors staff passent par les commandes.

## Fonctionnement

- Une lecture de l'API publique d'OVH par minute, sans clé, seulement si au moins un espace a activé la veille.
- Seul ce qui **devient** disponible est annoncé. La première lecture n'annonce rien, de même après plus de 24 h sans lecture.
- Au plus une notification par alerte et par serveur toutes les 15 minutes ; un seul message par salon.
- 25 alertes par personne. Hors salon par défaut, il faut pouvoir écrire dans le salon choisi.
