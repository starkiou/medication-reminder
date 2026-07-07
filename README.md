# Pilule — suivi et rappel

App web installable sur iPhone (PWA) pour suivre le cycle 21 jours de prise / 7 jours de
pause de la pilule, avec une notification chaque jour à 21h — même téléphone
verrouillé — et une alerte pour racheter une boîte à temps.

Aucune donnée médicale n'est envoyée nulle part d'autre qu'à ta propre base Supabase.

> **À savoir avant de déployer** : la logique du cycle a été testée unitairement, mais
> l'intégration complète (Supabase + Vercel + notifications iOS) n'a pas pu être testée
> en conditions réelles avant que tu la déploies. Prévois un ou deux allers-retours de
> débogage au premier déploiement (variable d'environnement mal recopiée, permission
> refusée, etc.) plutôt qu'un fonctionnement parfait du premier coup.

## Tester sans iPhone et sans attendre 21h

Deux limites du test "en vrai" (iPhone requis, 21h pile) sont contournables :

**Tester sans iPhone** — la contrainte "installer sur l'écran d'accueil" est une
exigence propre à Safari/iOS. Sur ordinateur (Chrome, Edge) ou Android, l'app fonctionne
directement dans un onglet normal, sans installation :

1. Ouvre l'URL Vercel dans Chrome sur ton ordinateur.
2. Fais l'onboarding (date + numéro de plaquette).
3. Clique **Activer les notifications** et accepte la demande du navigateur.

Ça valide toute la chaîne (Supabase, clés VAPID, envoi de notification, contenu du
message) — seule l'installation "écran d'accueil" spécifique à iOS n'est pas testée par
ce biais, mais c'est la partie la plus simple et la moins susceptible de casser.

**Tester sans attendre 21h** — un endpoint dédié envoie la notification immédiatement,
sans regarder l'heure :

```
https://ton-app.vercel.app/api/test-notification?key=LA_VALEUR_DE_CRON_SECRET
```

Ouvre simplement cette URL dans un navigateur (remplace par ta vraie valeur de
`CRON_SECRET`) après avoir activé les notifications au moins une fois. Tu dois recevoir
la notification quelques secondes après. Cet endpoint exige que `CRON_SECRET` soit
défini sur Vercel — sans ça, il refuse de répondre, pour éviter que n'importe qui
connaissant l'URL ne déclenche une notification chez vous.

## Ce dont tu as besoin (tout est gratuit)

- Un compte [GitHub](https://github.com) (tu l'as déjà)
- Un compte [Vercel](https://vercel.com) — connecte-toi avec GitHub, ça suffit
- Un compte [Supabase](https://supabase.com) — connecte-toi avec GitHub aussi

## 1. Créer le projet Supabase

1. Sur [supabase.com](https://supabase.com), crée un nouveau projet (choisis une région
   proche, ex. Europe).
2. Une fois le projet créé, va dans **SQL Editor**, colle le contenu du fichier
   `supabase.sql` fourni ici, et exécute-le. Ça crée la table `app_state` avec une ligne
   de départ.
3. Va dans **Project Settings > API**. Note :
   - `Project URL` → ce sera `SUPABASE_URL`
   - `service_role` key (pas la `anon` key) → ce sera `SUPABASE_SERVICE_KEY`

## 2. Générer les clés de notification (VAPID)

Dans un terminal, sur ta machine :

```bash
npx web-push generate-vapid-keys
```

Ça affiche une clé publique et une clé privée. Garde les deux de côté.

## 3. Mettre le code sur GitHub

Depuis le dossier du projet :

```bash
git init
git add .
git commit -m "Première version"
```

Crée un nouveau repo (vide) sur GitHub, puis :

```bash
git remote add origin <URL_DE_TON_REPO>
git branch -M main
git push -u origin main
```

## 4. Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com), clique **Add New > Project**, choisis ton repo
   GitHub.
2. Laisse les réglages par défaut (Vercel détecte automatiquement le dossier `api/` et
   `public/`).
3. Avant de cliquer sur Deploy, ouvre **Environment Variables** et ajoute :

   | Nom | Valeur |
   |---|---|
   | `SUPABASE_URL` | celle notée à l'étape 1 |
   | `SUPABASE_SERVICE_KEY` | celle notée à l'étape 1 |
   | `VAPID_PUBLIC_KEY` | celle générée à l'étape 2 |
   | `VAPID_PRIVATE_KEY` | celle générée à l'étape 2 |
   | `VAPID_SUBJECT` | `mailto:ton-email@example.com` |
   | `CRON_SECRET` | une chaîne aléatoire de ton choix (optionnel mais recommandé) |

4. Clique **Deploy**. Après quelques secondes tu obtiens une URL du type
   `https://tracker-xxxx.vercel.app`.

Vercel relit `vercel.json` et programme automatiquement le rappel quotidien (voir plus
bas pourquoi il y a deux horaires).

## 5. Installer sur l'iPhone

1. Ouvre l'URL Vercel **dans Safari** (obligatoire — pas Chrome, pas d'autre navigateur).
2. Appuie sur l'icône **Partager**, puis **Sur l'écran d'accueil**.
3. Ouvre l'app depuis l'icône ajoutée à l'écran d'accueil (pas depuis Safari — les
   notifications ne marchent que depuis l'app installée).
4. Renseigne la date de début de la plaquette en cours et son numéro (1, 2 ou 3 sur la
   boîte).
5. Appuie sur **Activer les notifications** et accepte la demande d'autorisation iOS.

C'est prêt. Le rappel arrivera chaque jour à 21h.

## Comment ça fonctionne

- **Chaque jour à 21h (heure de Paris)**, un petit programme côté serveur regarde où en
  est le cycle et envoie une notification :
  - Jours 1 à 21 → « Prends ta pilule »
  - Jours 22 à 28 → « Jour de pause »
  - Si c'est la pause qui suit la 3ᵉ plaquette de la boîte → rappel d'en racheter une
- **Le bouton « J'ai oublié hier »** note simplement l'oubli pour ton information ; il ne
  modifie pas le calendrier (les règles de rattrapage restent celles de la notice du
  médicament).
- **Pourquoi deux horaires dans `vercel.json`** : les cron jobs de Vercel tournent en
  heure UTC fixe, qui ne suit pas automatiquement le changement heure d'été/hiver
  français. Le code programme donc un déclenchement à 19h **et** 20h UTC ; à chaque
  appel, le serveur vérifie l'heure réelle à Paris et n'envoie la notification que si
  elle correspond à 21h — l'autre appel de la journée est ignoré silencieusement.
  Résultat : la notification arrive le bon jour à la bonne heure, été comme hiver —
  mais **pas forcément pile à 21h00**. Sur le plan gratuit de Vercel, un cron programmé
  pour une heure donnée peut se déclencher n'importe quand dans l'heure qui suit (donc
  entre 21h00 et 21h59). Un créneau à la minute près nécessite le plan payant de
  Vercel.

## Modifier la date de départ plus tard

Depuis l'écran principal de l'app, le lien **Modifier la date de départ** permet de
recorriger la plaquette et le numéro de boîte sans tout réinstaller.

## Limites connues

- Pensée pour une seule personne (une seule ligne en base). Pour suivre plusieurs
  personnes il faudrait ajouter un identifiant par personne.
- Ce suivi est un outil de rappel, pas un avis médical : en cas d'oubli, se référer à la
  notice de la pilule ou à un professionnel de santé.
