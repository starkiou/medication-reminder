# Déployer l'application

## Nouvelle installation

### 1. Base de données

Créer un projet [Supabase](https://supabase.com), puis exécuter [supabase.sql](supabase.sql) dans l'éditeur SQL. Le script crée la table `app_state`.

Noter l'URL du projet et la clé `service_role` (Project Settings > API). Cette clé contourne toutes les règles d'accès de Supabase : elle ne doit jamais se retrouver dans le code ni dans le navigateur, seulement dans les variables d'environnement du serveur.

### 2. Clés des notifications

```bash
npx web-push generate-vapid-keys
```

### 3. Déploiement sur Vercel

Importer le dépôt dans [Vercel](https://vercel.com), puis renseigner les variables d'environnement (Settings > Environment Variables).

Obligatoires :

| Variable | Rôle |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_KEY` | Clé `service_role` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Clés générées à l'étape 2 |
| `VAPID_SUBJECT` | `mailto:` suivi d'une adresse de contact |
| `ACCESS_CODE` | Code demandé une fois par l'application sur chaque appareil |
| `CRON_SECRET` | Secret envoyé par le service de cron |

`ACCESS_CODE` et `CRON_SECRET` doivent être deux longues chaînes aléatoires différentes, par exemple le résultat de `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`. Tant que l'une des deux manque, les endpoints concernés répondent 503.

Facultatives, pour régler le suivi :

| Variable | Défaut | Rôle |
|---|---|---|
| `MED_NAME` | aucun | Nom du médicament affiché dans l'application et les notifications |
| `MED_DETAILS` | aucun | Lignes de détail sous le nom, séparées par `\|` |
| `MED_NOUN` | `traitement` | Nom commun utilisé dans les phrases (« prends ton traitement ») |
| `MED_NOUN_FEMININE` | `false` | `true` si le nom commun est féminin (« ta pilule ») |
| `PILL_DAYS` | `21` | Jours de prise par plaquette |
| `PAUSE_DAYS` | `7` | Jours de pause ; `0` pour une prise continue |
| `PACKS_PER_BOX` | `3` | Plaquettes par boîte |
| `REMINDER_HOUR` | `21` | Heure du rappel (0 à 23) |
| `BACKUP_HOUR` | `22` | Heure du rappel de secours ; `off` pour le désactiver |
| `TIMEZONE` | `Europe/Paris` | Fuseau horaire des heures ci-dessus |

Une valeur invalide fait échouer les endpoints avec une erreur explicite dans les journaux, au lieu d'être ignorée.

### 4. Jobs cron

Sur [cron-job.org](https://cron-job.org), créer deux jobs quotidiens :

| Job | URL | Heure |
|---|---|---|
| Rappel | `https://<app>.vercel.app/api/cron` | `REMINDER_HOUR` |
| Rappel de secours | `https://<app>.vercel.app/api/cron-backup` | `BACKUP_HOUR` |

Dans chaque job, régler le fuseau horaire sur celui de `TIMEZONE` et ajouter l'en-tête :

```
Authorization: Bearer <valeur de CRON_SECRET>
```

Le serveur revérifie l'heure dans le fuseau configuré : un appel hors de l'heure visée est ignoré. Les cinq minutes qui précèdent sont acceptées, pour tolérer un cron légèrement en avance.

### 5. Installation sur le téléphone

Ouvrir l'adresse de l'application. Sur iPhone, passer par Safari puis Partager > Sur l'écran d'accueil : les notifications ne fonctionnent que depuis l'icône installée. Saisir le code d'accès, renseigner la plaquette en cours, autoriser les notifications.

### 6. Vérifier

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/test-notification
```

La notification du jour arrive immédiatement, sans tenir compte de l'heure. Ajouter `?backup=1` pour recevoir le rappel de secours.

## Mettre à jour une installation d'avant le code d'accès

Les versions précédentes n'avaient pas de code d'accès et `CRON_SECRET` y était facultatif. **Faire ces étapes dans l'ordre, avant de déployer la nouvelle version**, sinon les rappels s'arrêtent :

1. **Vercel** : ajouter `ACCESS_CODE`. Vérifier que `CRON_SECRET` existe, sinon l'ajouter.
2. **cron-job.org** : vérifier que les deux jobs envoient bien l'en-tête `Authorization: Bearer <CRON_SECRET>`. Sans lui, les appels seront refusés et aucun rappel ne partira.
3. **Vercel** : pour garder les mêmes textes qu'avant, renseigner `MED_NAME`, `MED_DETAILS`, `MED_NOUN` et `MED_NOUN_FEMININE`.
4. Déployer d'abord sur une préversion (une branche autre que `main`) et vérifier :
   - `curl https://<préversion>/api/state` répond 401 ;
   - `curl -H "X-Access-Code: <code>" https://<préversion>/api/state` répond 200 ;
   - `curl -H "Authorization: Bearer <CRON_SECRET>" https://<préversion>/api/test-notification` envoie bien la notification.
5. Fusionner dans `main`.
6. Sur le téléphone, l'application demande le code d'accès à la prochaine ouverture, une seule fois. Les rappels, eux, continuent d'arriver même avant la saisie du code : ils ne dépendent que du serveur.

Aucune modification de la base n'est nécessaire.

L'ancien lien de test `…/api/test-notification?key=…` ne fonctionne plus : le secret passe désormais dans l'en-tête `Authorization`.
