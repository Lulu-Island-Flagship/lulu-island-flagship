# CONTRAT DE SERVICE DE NETTOYAGE RÉCURRENT
## Lulu Island Flagship | Richmond, Colombie-Britannique
**Version :** 0.1 (Ébauche — en attente de révision par un avocat agréé en C.-B.)
**Date :** 6 août 2026
**Type :** `recurring_contract` (annuel — renouvellement automatique avec ajustement IPC)
**Langues :** Français | [English](recurring-contract-v0.1-en.md)

---

**IMPORTANT :** Le présent contrat régit une relation de nettoyage récurrente et continue. Il intègre le Contrat de service client ponctuel (`client_terms`) de la Société pour toutes les dispositions relatives à chaque service individuel (portée du service, mode de paiement, garantie, accès, verrouillage chimique, exclusions, responsabilité, protection des renseignements personnels, intérêts de retard et règlement des différends). Le Client reconnaît avoir accepté le Contrat de service client au moment de sa première réservation. Le présent contrat ajoute et, en cas de conflit, prévaut sur les conditions propres à la relation récurrente.

---

**Le présent contrat** est conclu entre :

**Prestataire de services :** Lulu Island Flagship Cleaning Services Inc., société constituée en vertu des lois de la Colombie-Britannique, dont le siège social est situé à Richmond (C.-B.) (« la Société »)

**Client :** `[NOM_COMPLET_CLIENT]`, résidant au `[ADRESSE_FACTURATION_CLIENT]` (« le Client »)

(Collectivement « les Parties »)

---

## 1. PLAN DE SERVICE RÉCURRENT

1.1 **Type de plan.** Le Client s'inscrit au plan de nettoyage récurrent suivant :

| Détail du plan | Valeur |
|---|---|
| Type de service | `[TYPE_SERVICE]` (p. ex. Nettoyage d'entretien) |
| Fréquence | `[FREQUENCE]` (Hebdomadaire / Bi-hebdomadaire / Mensuel) |
| Jour(s) privilégié(s) | `[JOURS_PRIVILEGIES]` |
| Fenêtre horaire privilégiée | `[DEBUT_FENETRE]` – `[FIN_FENETRE]` |
| Adresse de la propriété | `[ADRESSE_SERVICE]`, Richmond (C.-B.) |
| Superficie BC Assessment | `[SUPERFICIE_BC_ASSESSMENT]` m² |

1.2 **Service initial.** Le premier service en vertu du présent contrat est le nettoyage initial en profondeur, terminé le `[DATE_NETTOYAGE_INITIAL]`. Les services suivants sont des nettoyages d'entretien à la fréquence indiquée ci-dessus. Le prix du nettoyage initial est distinct du prix récurrent et a été payé en vertu du Contrat de service client ponctuel.

1.3 **Référence des zones.** Les zones et suppléments inclus dans chaque service récurrent sont les mêmes que ceux choisis par le Client lors de la réservation initiale, tels qu'enregistrés dans le profil documenté du domicile du Client. Le Client peut modifier les zones ou les suppléments à tout moment par l'intermédiaire du Portail Client; les modifications prennent effet au prochain service prévu et peuvent ajuster le prix récurrent.

1.4 **Intégration du Contrat de service client.** Chaque service individuel en vertu du présent contrat est régi par le Contrat de service client (`client_terms`) de la Société alors en vigueur, y compris toutes les dispositions relatives à : la portée du service, le mode de paiement (retenue et capture différée via Stripe), la garantie (preuve photographique), l'accès à la propriété, le verrouillage chimique, les exclusions (risque biologique, moisissures, nuisibles, syllogomanie), la responsabilité et l'assurance, la protection des renseignements personnels (PIPA C.-B.), les intérêts de retard (Loi sur l'intérêt) et le règlement des différends. La version actuelle du Contrat de service client est toujours disponible sur le site Web de la Société. En cas de conflit entre le présent contrat et le Contrat de service client, le présent contrat prévaut en ce qui concerne les conditions de la relation récurrente (articles 1 à 10 du présent contrat).

---

## 2. PRIX RÉCURRENT ET AJUSTEMENT IPC ANNUEL

2.1 **Prix récurrent par service.** Le prix par service récurrent est de **`[PRIX_RECURRENT]` $ CAD** (TPS/TVH incluse). Ce prix est fixe pour la première année du présent contrat.

2.2 **Ajustement IPC annuel.** À chaque date anniversaire de la date d'entrée en vigueur (article 5.1), le prix par service est ajusté en fonction de l'indice des prix à la consommation (IPC) de la Colombie-Britannique, ensemble global, tel que publié par Statistique Canada pour les douze (12) mois les plus récents pour lesquels des données sont disponibles. L'ajustement est calculé et appliqué par le système de la Société (`contract-ipc-adjustment.ts`).

2.3 **Formule d'ajustement.** Le prix ajusté est calculé comme suit :

```
Nouveau prix = Prix actuel × (1 + Variation_IPC_%)
```

Où `Variation_IPC_%` est la variation en pourcentage sur douze mois de l'IPC de la C.-B. L'ajustement ne peut jamais réduire le prix en deçà du prix initial au début de l'année contractuelle.

2.4 **Avis d'ajustement.** La Société avise le Client par écrit (courriel ou notification du Portail Client) de tout ajustement IPC au moins trente (30) jours avant la date d'entrée en vigueur. L'avis comprend le nouveau prix par service, le chiffre de l'IPC utilisé et un lien vers la source de Statistique Canada.

2.5 **Gel du prix pendant une pause.** Si le Client suspend les services en vertu de l'article 4.3, l'ajustement IPC est calculé comme si la période de pause n'avait pas existé — c'est-à-dire que l'ajustement est fondé sur la date anniversaire civile et non sur le nombre de services effectués.

2.6 **Aucune autre augmentation de prix.** Le prix par service ne peut augmenter pendant une année contractuelle, sauf par l'ajustement IPC annuel prévu au présent article, à moins que le Client n'ajoute des zones ou des suppléments (article 1.3) ou ne fasse de fausses déclarations sur des facteurs influant sur la tarification (conformément au Contrat de service client, articles 1.6 et 1.7 sur la charge organique et l'IES).

---

## 3. PLANIFICATION ET PRIORITÉ

3.1 **Priorité de planification.** Les clients récurrents bénéficient d'une priorité dans le système de planification de la Société. La Société fonctionne selon un modèle 70/30 (`schedule-7030.ts`) : environ 70 % de la capacité hebdomadaire est réservée aux clients récurrents, les 30 % restants étant disponibles pour les réservations ponctuelles. Au sein de la tranche de 70 % réservée aux clients récurrents, les créneaux sont attribués par ordre d'ancienneté du plan, sous réserve de l'optimisation géographique des tournées.

3.2 **Jour et heure privilégiés.** La Société déploie des efforts commerciaux raisonnables pour planifier les services du Client le ou les jours et la fenêtre horaire privilégiés indiqués à l'article 1.1. La Société avise le Client au moins quarante-huit (48) heures à l'avance de tout écart par rapport à l'horaire privilégié.

3.3 **Report par le Client.** Le Client peut reporter un service individuel sans frais en donnant un préavis d'au moins quarante-huit (48) heures par l'intermédiaire du Portail Client. Les services reportés sont assujettis à la disponibilité dans le même cycle de facturation.

3.4 **Sauter un service.** Le Client peut sauter jusqu'à `[MAX_SAUTS_PAR_AN]` services par année contractuelle sans que cela n'affecte son statut. Les services sautés ne sont pas facturés. Le Client doit donner un préavis d'au moins quarante-huit (48) heures pour sauter un service. Au-delà du nombre de sauts autorisés, les services sautés sont facturés à cinquante pour cent (50 %) du prix par service afin de réserver le créneau prioritaire du Client (voir l'article 4.3 pour les options de pause officielle).

3.5 **Report par la Société.** Si la Société doit reporter un service en raison d'un jour férié, de conditions météorologiques extrêmes (`weather-exception.ts`) ou d'une nécessité opérationnelle, elle en avise le Client et lui propose le prochain créneau disponible. Aucun frais ne s'applique pour les services reportés par la Société que le Client ne peut accommoder.

---

## 4. DURÉE, RENOUVELLEMENT ET PAUSE

4.1 **Durée initiale.** Le présent contrat entre en vigueur à la date d'entrée en vigueur (article 5.1) et se poursuit pour une durée initiale d'un (1) an.

4.2 **Renouvellement automatique.** Le présent contrat se renouvelle automatiquement pour des périodes successives d'un an à chaque date anniversaire de la date d'entrée en vigueur, à moins que l'une ou l'autre des Parties ne donne un avis de non-renouvellement au moins trente (30) jours avant la date anniversaire.

4.3 **Pause.** Le Client peut suspendre tous les services récurrents pour une période de `[SEMAINES_PAUSE_MIN]` à `[SEMAINES_PAUSE_MAX]` semaines par année contractuelle en donnant un préavis écrit d'au moins sept (7) jours par l'intermédiaire du Portail Client. Pendant la pause, aucun service n'est effectué, aucun frais n'est engagé et le créneau prioritaire du Client est conservé. La date anniversaire du contrat n'est pas prolongée par la période de pause. Une pause dépassant le maximum est traitée comme une résiliation par le Client en vertu de l'article 6.2.

4.4 **Motifs de pause.** Les motifs courants de pause comprennent les vacances, les rénovations domiciliaires ou les voyages prolongés. Le Client n'est pas tenu de fournir un motif, seulement les dates de début et de fin de la pause.

4.5 **Reprise après une pause.** À la reprise, le premier service est traité comme un nettoyage d'entretien standard au prix récurrent alors en vigueur. Si le Client a fait une pause de plus de `[SEUIL_NETTOYAGE_PROFOND_SEMAINES]` semaines, la Société peut recommander (mais non exiger) un nettoyage en profondeur au tarif ponctuel alors en vigueur avant la reprise de l'horaire récurrent. Le Client peut refuser cette recommandation sans pénalité.

---

## 5. DATE D'ENTRÉE EN VIGUEUR ET DATE ANNIVERSAIRE

5.1 **Date d'entrée en vigueur.** Le présent contrat entre en vigueur le `[DATE_ENTREE_EN_VIGUEUR]`, soit la date à laquelle le Client a accepté le présent contrat après avoir terminé le nettoyage initial et s'être inscrit au plan récurrent.

5.2 **Date anniversaire.** La date anniversaire pour l'ajustement IPC (article 2.2), la révision du contrat (article 8) et le renouvellement (article 4.2) est le `[DATE_ANNIVERSAIRE]`, soit douze (12) mois après la date d'entrée en vigueur, puis à chaque douzième mois suivant.

5.3 **Début du contrat et date anniversaire.** La date du nettoyage initial, la date d'entrée en vigueur du présent contrat et la première date anniversaire peuvent différer. Seule la date d'entrée en vigueur régit la durée, le renouvellement et le calendrier d'ajustement IPC.

---

## 6. RÉSILIATION

6.1 **Résiliation par la Société.** La Société peut résilier le présent contrat :

- **(a) Manquement important :** Immédiatement sur préavis écrit si le Client commet un manquement important au présent contrat ou au Contrat de service client intégré, y compris, sans s'y limiter : le non-paiement de deux (2) services consécutifs ou plus, la fourniture de renseignements faux, la création d'un environnement de travail dangereux ou le harcèlement du personnel de la Société.
- **(b) Sans motif :** Sur préavis écrit de trente (30) jours pour quelque raison que ce soit. La Société termine tous les services prévus pendant la période de préavis.
- **(c) Abandon de la zone de service :** Sur préavis écrit de trente (30) jours si la Société cesse ses activités dans la zone géographique du Client. Les services payés d'avance mais non exécutés sont remboursés au prorata.

6.2 **Résiliation par le Client.** Le Client peut résilier le présent contrat :

- **(a) Sans motif :** Sur préavis écrit de trente (30) jours par l'intermédiaire du Portail Client. Le Client peut choisir de recevoir ou de refuser les services prévus pendant la période de préavis. Les services refusés pendant la période de préavis ne sont pas facturés et le créneau prioritaire est libéré.
- **(b) Contestation de prix :** Dans les quatorze (14) jours suivant la réception d'un avis d'ajustement IPC (article 2.4), si le Client n'accepte pas le prix ajusté. Les services prévus avant la date d'entrée en vigueur de l'ajustement sont effectués au prix existant.

6.3 **Effet de la résiliation.** En cas de résiliation, le statut de plan récurrent, la priorité de planification, les avantages de fidélité et le statut d'ambassadeur du Client prennent fin. Le Client peut continuer à réserver des services ponctuels en vertu du Contrat de service client standard. Tout solde impayé demeure exigible. Le profil documenté du domicile du Client et les renseignements d'accès chiffrés sont conservés conformément à la politique de confidentialité de la Société (PIPA C.-B.), à moins que le Client n'en demande la suppression.

6.4 **Aucuns frais de résiliation anticipée.** La Société n'impose aucuns frais de résiliation anticipée. Le préavis de trente (30) jours est la seule exigence pour une résiliation sans motif initiée par le Client.

---

## 7. AVANTAGES DE FIDÉLITÉ ET D'AMBASSADEUR

7.1 **Portefeuille Lulu.** Les clients récurrents participent automatiquement au programme de fidélité Lulu Wallet (`loyalty-program.ts`). Les crédits s'accumulent par service terminé. Les crédits du Portefeuille peuvent être appliqués aux suppléments, aux mises à niveau de nettoyage en profondeur ou aux services offerts en cadeau. Les conditions du Portefeuille (taux d'accumulation, expiration, échange) sont publiées dans le Portail Client et peuvent être mises à jour par la Société moyennant un préavis de trente (30) jours.

7.2 **Badges et jalons.** Le Client gagne des badges de jalon pour l'ancienneté de service (`badges.ts`). Les badges sont affichés dans le Portail Client et peuvent débloquer des avantages périodiques (p. ex. supplément gratuit à la date anniversaire, priorité pendant les saisons de pointe).

7.3 **Programme d'ambassadeur Lulu.** Après `[SERVICES_ADMISSIBLES_AMBASSADEUR]` services récurrents terminés, le Client devient admissible au programme de recommandation d'ambassadeur Lulu (`referrals.ts`). Les avantages d'ambassadeur comprennent : des crédits de recommandation pour chaque nouveau client qui termine un service, et des taux d'accumulation bonifiés au Portefeuille. Le statut d'ambassadeur est conditionnel au maintien d'un plan récurrent actif.

7.4 **Aucune valeur en espèces.** Les crédits de fidélité, les badges et les avantages d'ambassadeur n'ont aucune valeur en espèces en dehors de la plateforme de la Société et ne sont pas échangeables contre de l'argent.

---

## 8. RÉVISION ANNUELLE DU CONTRAT ET CONFORMITÉ LÉGALE

8.1 **Fenêtre de révision automatisée.** Soixante (60) jours avant chaque date anniversaire, le système de gestion des contrats de la Société (`contract-review.ts`) lance une révision automatisée du présent contrat par rapport à toute modification du droit applicable détectée par le système de veille juridique (`legal-monitoring.ts`). Le système génère un rapport énumérant tout changement réglementaire susceptible d'affecter les conditions du présent contrat.

8.2 **Révision par l'administrateur.** L'administrateur de la Société examine le rapport automatisé et détermine si le présent contrat doit être modifié. Si une modification est nécessaire, la Société doit :

- Générer une nouvelle version du présent contrat intégrant les modifications requises
- Marquer la version précédente comme « remplacée » (jamais supprimée)
- Fournir au Client un journal des modifications résumant les différences
- Remettre le contrat mis à jour au Client au moins trente (30) jours avant la date anniversaire

8.3 **Acceptation par le Client.** Le Client examine et accepte (par signature électronique via le Portail Client ou le fournisseur de signature électronique de la Société, `esignature-provider.ts`) le contrat mis à jour. Si le Client n'accepte pas le contrat mis à jour dans les trente (30) jours suivant sa remise, le présent contrat n'est pas renouvelé (article 4.2) et prend fin à l'échéance du terme en cours.

8.4 **Scénario sans modification.** Si la révision automatisée ne révèle aucun changement réglementaire nécessitant une modification et que la Société détermine qu'aucune autre modification n'est nécessaire, le contrat existant se renouvelle automatiquement sans aucune action des Parties.

8.5 **IPC et révision légale.** L'ajustement annuel du prix selon l'IPC (article 2.2) et la révision légale annuelle (le présent article 8) sont des processus distincts. Un ajustement IPC seul ne nécessite pas l'acceptation par le Client d'une nouvelle version du contrat; il prend effet sur notification (article 2.4). Seules les modifications du texte du contrat exigent le processus prévu au présent article.

---

## 9. SIGNATURE ÉLECTRONIQUE ET ACCEPTATION

9.1 **Acceptation lors de l'inscription.** Le Client accepte le présent contrat en cliquant sur « Activer le plan récurrent » ou sur un bouton d'acceptation équivalent lors du processus d'inscription au plan récurrent. Cette action constitue une signature électronique ayant la même valeur juridique qu'une signature manuscrite.

9.2 **Registre d'acceptation.** La Société enregistre l'acceptation du Client avec les métadonnées suivantes, stockées de manière immuable dans le système : nom du Client, courriel, adresse IP, horodatage de l'acceptation et version exacte du présent contrat acceptée.

9.3 **Réacceptation annuelle en cas de modification.** Si le contrat est modifié en vertu de l'article 8, l'acceptation de la nouvelle version par le Client est enregistrée avec les mêmes métadonnées, et la nouvelle version régit la relation à compter de la date anniversaire. La version précédente demeure disponible dans le système à titre de registre historique.

9.4 **Fournisseur de signature électronique.** La Société utilise un fournisseur de signature électronique conforme à la PIPA (`esignature-provider.ts`). L'acceptation par clic est suffisante pour l'inscription initiale et pour la réacceptation annuelle de modifications non importantes. La Société peut exiger une signature électronique officielle pour les modifications importantes.

---

## 10. DISPOSITIONS GÉNÉRALES

10.1 **Intégralité du contrat.** Le présent contrat, ainsi que le Contrat de service client intégré (`client_terms`), la Politique d'annulation à `/cancellation` et la Politique de confidentialité à `/privacy`, constitue l'intégralité de l'entente entre les Parties relativement à la relation de nettoyage récurrente et remplace toutes les discussions, représentations et ententes antérieures, qu'elles soient écrites ou verbales.

10.2 **Ordre de préséance.** En cas de conflit entre les documents constituant le présent contrat, l'ordre de préséance est le suivant : (1) le présent Contrat de service de nettoyage récurrent, (2) le Contrat de service client, (3) la Politique d'annulation, (4) la Politique de confidentialité.

10.3 **Absence de renonciation.** Le défaut de l'une ou l'autre des Parties d'appliquer une disposition ne constitue pas une renonciation à cette disposition ni à toute autre disposition.

10.4 **Divisibilité.** Si une disposition est jugée invalide ou inapplicable, les autres dispositions demeurent en vigueur et de plein effet, et la disposition invalide est modifiée dans la mesure minimale nécessaire pour la rendre valide et applicable.

10.5 **Force majeure.** Aucune des Parties n'est responsable du défaut ou du retard d'exécution causé par des événements échappant à leur contrôle raisonnable, y compris, sans s'y limiter : les catastrophes naturelles, les conditions météorologiques extrêmes, les pandémies, les troubles civils ou les ordonnances gouvernementales. La Partie touchée en avise l'autre rapidement et reprend l'exécution dès que cela est raisonnablement possible. Pendant un événement de force majeure touchant la Société, le Client n'est pas facturé pour les services qui ne peuvent être effectués, et le statut prioritaire du Client est préservé.

10.6 **Cession.** Le Client ne peut céder le présent contrat sans le consentement écrit préalable de la Société. La Société peut céder le présent contrat à une entité successeur en cas de fusion, d'acquisition ou de vente de la quasi-totalité de ses actifs, à condition que le cessionnaire assume toutes les obligations.

10.7 **Avis.** Tous les avis en vertu du présent contrat sont donnés par écrit. Les avis au Client sont envoyés à l'adresse courriel figurant au dossier du Portail Client ou par notification du Portail Client. Les avis à la Société sont envoyés par l'intermédiaire du Portail Client ou à `[COURRIEL_SOCIETE]`. Les avis sont réputés reçus le jour ouvrable suivant leur envoi.

10.8 **Langue.** Le présent contrat est fourni en anglais et en français. En cas de divergence, la version anglaise prévaut dans la mesure permise par la loi applicable.

10.9 **Droit applicable.** Le présent contrat est régi et interprété conformément aux lois de la province de la Colombie-Britannique et aux lois fédérales applicables du Canada. Les tribunaux de la Colombie-Britannique ont compétence exclusive.

---

## ACCEPTATION

**Le Client accepte le présent contrat par voie électronique lors de l'inscription :**

- Nom du Client : `[NOM_COMPLET_CLIENT]`
- Courriel du Client : `[COURRIEL_CLIENT]`
- Adresse IP : `[IP_CLIENT]`
- Horodatage de l'acceptation : `[DATE_HEURE_ACCEPTATION]`
- Version du contrat : 0.1
- Date d'entrée en vigueur : `[DATE_ENTREE_EN_VIGUEUR]`
- Date anniversaire : `[DATE_ANNIVERSAIRE]`

En cliquant sur « Activer le plan récurrent », le Client reconnaît avoir lu, compris et accepté les conditions du présent contrat et des documents incorporés par renvoi.

---

*Ce document est la version 0.1 du Contrat de service de nettoyage récurrent de Lulu Island Flagship. Il s'agit d'une ébauche en attente de révision par un avocat autorisé à exercer en Colombie-Britannique. Le système assure le suivi de l'historique des versions, des ajustements IPC, des alertes de changements légaux et des métadonnées d'acceptation; aucune version n'est jamais supprimée. La révision automatisée du contrat (article 8) s'exécute soixante jours avant chaque date anniversaire. Pour la version exécutoire régissant une relation récurrente spécifique, consulter le système de gestion des contrats (`contract-review.ts`, `contract-ipc-adjustment.ts`, `legal-monitoring.ts`).*
