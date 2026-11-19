# SAMA BUSINESS — Prototype V1

## Ce que contient cette version
- Application web responsive installable comme PWA.
- Données de démonstration conservées localement dans IndexedDB.
- Ventes, produits, stocks et dépenses.
- Cache de l'interface pour une ouverture hors connexion après le premier chargement.
- Schéma SQL de départ pour Supabase.

## Limites importantes
Cette archive est un prototype local, pas encore une application SaaS prête pour des clients.
- La synchronisation Supabase n'est PAS implémentée.
- Les comptes, invitations et permissions ne sont pas encore branchés.
- Les traductions wolof et anglaises sont à compléter.
- Les données restent sur le navigateur/appareil utilisé. Effacer les données du navigateur peut les supprimer.
- Pas de sauvegarde cloud ni de partage entre téléphones.
Ne saisissez pas de données commerciales sensibles ou réelles avant d'avoir mis en place la sauvegarde, l'authentification, la synchronisation et les tests de sécurité.

## Utiliser depuis un téléphone
Le moyen le plus simple est d'utiliser GitHub via le navigateur mobile :
1. Créez un compte GitHub si nécessaire.
2. Créez un nouveau dépôt privé nommé `sama-business`.
3. Téléversez le contenu de cette archive en conservant les dossiers.
4. Activez GitHub Pages dans Settings > Pages (branche main, dossier root), ou utilisez un hébergeur statique HTTPS.
5. Ouvrez l'adresse HTTPS sur Chrome Android.
6. Utilisez le menu du navigateur puis « Ajouter à l'écran d'accueil » / « Installer l'application ».
Le service worker et l'installation PWA exigent HTTPS (sauf localhost).

## Test local
Ouvrir `index.html` directement peut empêcher le service worker. Pour tester le mode PWA, hébergez les fichiers sur HTTPS.

## Configurer Supabase (administrateur/développeur)
1. Créez un projet Supabase.
2. Ouvrez SQL Editor.
3. Exécutez `supabase/schema.sql`.
4. Configurez l'authentification et une fonction sécurisée d'onboarding.
5. N'exposez que la clé `anon`/publishable dans le client, jamais `service_role`.
6. Implémentez les opérations serveur atomiques pour enregistrer vente + lignes + mouvement de stock.
7. Ajoutez la synchronisation idempotente et la gestion des conflits.
Le formulaire de configuration de l'interface ne connecte pas encore Supabase.

## Architecture recommandée pour la suite
- Client : Flutter ou PWA avancée. Pour démarrer au téléphone et limiter les coûts, valider d'abord la PWA.
- Stockage local : IndexedDB (web), SQLite (Android natif si Flutter).
- Serveur : Supabase PostgreSQL + Auth + RLS.
- Sync : file d'opérations avec UUID, idempotence, reprises et résolution des conflits.
- Tests : vente hors ligne, double synchronisation, stock concurrent, séparation des commerces, sauvegarde/restauration.

## Avant une vraie mise en production
- Faire auditer les politiques RLS et les fonctions SQL.
- Ajouter tests automatisés et sauvegardes vérifiées.
- Mettre en place politique de confidentialité et conditions d'utilisation.
- Définir la conservation/suppression des données et le support client.
- Vérifier les obligations légales, fiscales et de protection des données applicables au Sénégal.
