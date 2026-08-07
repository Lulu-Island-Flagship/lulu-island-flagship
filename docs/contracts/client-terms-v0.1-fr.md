# CONTRAT DE SERVICE CLIENT — NETTOYAGE PONCTUEL
## Lulu Island Flagship | Richmond, Colombie-Britannique
**Version :** 0.1 (Ébauche — en attente de révision par un avocat agréé en C.-B.)
**Date :** 6 août 2026
**Type :** `client_terms` (réservation ponctuelle — sans renouvellement)
**Langues :** Français | [English](client-terms-v0.1-en.md)

---

**Le présent contrat** est conclu entre :

**Prestataire de services :** Lulu Island Flagship Cleaning Services Inc., société constituée en vertu des lois de la Colombie-Britannique, dont le siège social est situé à Richmond (C.-B.) (« la Société »)

**Client :** `[NOM_COMPLET_CLIENT]`, résidant au `[ADRESSE_FACTURATION_CLIENT]` (« le Client »)

(Collectivement « les Parties »)

---

## 1. PORTÉE DU SERVICE

1.1 **Propriété.** Le service de nettoyage est effectué au : `[ADRESSE_SERVICE]`, Richmond (C.-B.) (la « Propriété »).

1.2 **Superficie selon BC Assessment.** La superficie de la Propriété, telle qu'enregistrée par BC Assessment, est de `[SUPERFICIE_BC_ASSESSMENT]` mètres carrés. Ce chiffre est obtenu de la base de données provinciale (`bc-assessment.ts`) et constitue la seule base de tarification. Le Client reconnaît que le prix fixe découle de cette mesure objectivement vérifiable.

1.3 **Type de service.** Le service est classé comme : `[TYPE_SERVICE]` (p. ex. nettoyage en profondeur, nettoyage d'entretien, nettoyage de déménagement).

1.4 **Zones incluses.** Les zones suivantes sont incluses dans ce service, chacune avec son poids attribué par le moteur de tarification de la Société (`pricing.ts`, `addon-zones.ts`) :

| Zone | Poids | Incluse |
|---|---|---|
| `[NOM_ZONE_1]` | `[POIDS_ZONE_1]×` | Oui |
| `[NOM_ZONE_2]` | `[POIDS_ZONE_2]×` | Oui |
| ... | ... | ... |

1.5 **Suppléments.** Les services optionnels suivants ont été ajoutés à cette réservation :

| Supplément | Prix |
|---|---|
| `[NOM_SUPPLEMENT_1]` | `[PRIX_SUPPLEMENT_1]` $ |
| `[NOM_SUPPLEMENT_2]` | `[PRIX_SUPPLEMENT_2]` $ |

1.6 **Ajustement pour charge organique.** La tarification inclut un ajustement pour les facteurs de charge organique déclarés par le Client (animaux : `[NOMBRE_ANIMAUX]`; résidents : `[NOMBRE_RESIDENTS]`). Toute fausse déclaration de ces facteurs peut entraîner une correction de prix ou un refus de service.

1.7 **Indice entropique de saleté (IES).** Le Client a autoévalué l'état de la Propriété au niveau IES `[NIVEAU_IES]` (échelle de 1,0 à 4,0). Un écart de plus d'un point IES complet constaté à l'arrivée autorise la Société à ajuster le prix ou à reporter le service. Le niveau 5 (risque biologique) est exclu — voir l'article 9.

1.8 **Date et heure prévues.** Le service est prévu le `[DATE_SERVICE]` avec une fenêtre d'arrivée de `[DEBUT_FENETRE_ARRIVEE]` à `[FIN_FENETRE_ARRIVEE]`. La Société envoie une notification par SMS ou courriel lorsque l'équipe est en route (`live-tracking.ts`).

---

## 2. PRIX FIXE ET TAXES

2.1 **Prix fixe.** Le prix total de ce service est de **`[PRIX_TOTAL]` $ CAD**, calculé par le moteur de tarification de la Société en fonction de la superficie BC Assessment, des poids des zones, des suppléments, de la charge organique et du niveau IES. Ce prix est fixe et communiqué à l'avance. Le Client ne voit jamais de taux horaire ni de fourchette de prix.

2.2 **TPS/TVH.** La taxe sur les produits et services (TPS) de `[MONTANT_TPS]` $ CAD est incluse dans le total ci-dessus. Le numéro d'inscription TPS/TVH de la Société est le `[NUMERO_TPS]`. Cette taxe est perçue conformément à la Partie IX de la *Loi sur la taxe d'accise* (Canada).

2.3 **Aucun frais caché.** Le prix indiqué est le prix que paie le Client. Aucun supplément de carburant, frais de déplacement ou supplément pour produits de nettoyage ne sera ajouté après la réservation, sauf si le Client a fait de fausses déclarations sur des faits importants (voir les articles 1.6 et 1.7).

---

## 3. PAIEMENT

3.1 **Retenue et capture différée.** Le Client autorise la Société à placer une retenue sur sa carte de paiement pour le prix total au moment de la réservation. Le débit réel (capture) a lieu dans les vingt-quatre (24) heures suivant la fin du service et son approbation par le processus de contrôle de la qualité de la Société (`batch-capture-eligibility.ts`).

3.2 **Mode de paiement.** Le paiement est traité par Stripe, le processeur de paiement de la Société (`stripe.ts`). Les détails de la carte ne sont jamais stockés sur les serveurs de la Société.

3.3 **Option de versements.** Si le prix total dépasse `[SEUIL_VERSEMENTS]` $ CAD et que le Client a choisi l'option de versements lors de la réservation, le total est divisé en `[NOMBRE_VERSEMENTS]` paiements égaux débités selon le calendrier établi dans le flux de réservation (`installment-payment.ts`).

3.4 **Paiement refusé.** Si la capture finale est refusée par l'institution financière du Client, la Société en avise le Client et lui accorde quarante-huit (48) heures pour résoudre le problème. À défaut de résolution, l'article 11 (Intérêts de retard) s'applique.

---

## 4. ANNULATION ET REPORT

4.1 **Annulation par le Client.** Le Client peut annuler ce service sans frais en donnant un préavis d'au moins quarante-huit (48) heures avant la fenêtre d'arrivée prévue. L'annulation peut être effectuée par l'intermédiaire du Portail Client (`/account/services`) ou en contactant directement la Société.

4.2 **Frais d'annulation tardive.** Si le Client annule avec moins de quarante-huit (48) heures de préavis, la Société peut facturer des frais d'annulation de `[FRAIS_ANNULATION_TARDIVE]` $ CAD ou de `[POURCENTAGE_ANNULATION_TARDIVE]` % du prix total, selon le montant le moins élevé.

4.3 **Absence du Client.** Si l'équipe arrive à la Propriété pendant la fenêtre prévue et ne peut y accéder pour des raisons relevant du contrôle du Client (y compris, sans s'y limiter : absence de réponse, entrée verrouillée sans clé au dossier ou environnement dangereux), le service est traité comme une annulation tardive et les frais prévus à l'article 4.2 s'appliquent.

4.4 **Annulation par la Société.** La Société se réserve le droit d'annuler ou de reporter le service en raison de : conditions météorologiques extrêmes (`weather-exception.ts`), défaillance d'équipement, indisponibilité de personnel ou préoccupations de sécurité. Si la Société annule, aucun frais n'est facturé et la Société offre un report prioritaire.

4.5 **Page de la politique d'annulation.** La politique d'annulation complète, y compris les instructions détaillées, est publiée sur le site Web de la Société (`/cancellation`) et est incorporée par renvoi au présent contrat.

---

## 5. GARANTIE ET ASSURANCE QUALITÉ

5.1 **Garantie fondée sur la preuve photographique.** La Société garantit que chaque zone entretenue est nettoyée conformément à la procédure opérationnelle normalisée (SOP) documentée de la Société. Une fois le service terminé, l'équipe de nettoyage prend des photos horodatées et géolocalisées de chaque zone par l'intermédiaire du système PWA de la Société. Ces photos constituent la seule preuve pour les réclamations au titre de la garantie.

5.2 **Réclamation au titre de la garantie.** Si le Client estime qu'une zone n'a pas été nettoyée conformément à la norme, il doit soumettre une réclamation dans les vingt-quatre (24) heures suivant la fin du service par l'intermédiaire du sondage post-service (`/review/[token]`) ou du Portail Client. La réclamation est évaluée par rapport aux photos horodatées de fin de service par l'équipe de contrôle de la qualité de la Société (`AdminQCClient.tsx`).

5.3 **Recours.** Si l'examen du contrôle de la qualité confirme la réclamation, la Société doit, à son choix : (a) nettoyer de nouveau la zone concernée sans frais supplémentaires dans un délai de `[DELAI_RECOURS]` jours ouvrables, ou (b) émettre un crédit partiel proportionnel au poids de la zone concernée. La Société n'offre pas de remboursement en espèces.

5.4 **Aucune garantie sans preuve.** La garantie est conditionnelle à la preuve photographique des deux Parties. La Société ne peut traiter les réclamations fondées uniquement sur des descriptions verbales (Invariant n° 6 : la preuve plutôt que l'opinion). Les conditions complètes de la garantie sont publiées sur le site Web de la Société (`warranty-visibility.ts`, `warranty-dispute-resolution.ts`).

---

## 6. ACCÈS À LA PROPRIÉTÉ

6.1 **Méthodes d'accès.** Le Client fournit l'accès à la Propriété par l'une des méthodes suivantes, choisie lors de la réservation :

- **Client présent :** Le Client ou un adulte autorisé (18 ans et plus) est présent pour accueillir l'équipe.
- **Clé au dossier :** Le Client a fourni une clé conservée dans le système chiffré de la Société (`key-handling.ts`, `crypto.ts`).
- **Boîte à clés / code d'accès :** Le Client a fourni un code de boîte à clés ou un code de porte, conservé sous forme chiffrée.

6.2 **Absence d'accès — absence du Client.** Si l'équipe ne peut accéder à la Propriété par la méthode choisie, l'article 4.3 (Absence du Client) s'applique.

6.3 **Sécurité des clés.** Toutes les clés physiques portent un code non identifiant (jamais l'adresse du Client). Les clés et les codes d'accès sont chiffrés au repos et en transit. Le protocole de manipulation des clés (`key-handling.ts`) régit toutes les opérations liées aux clés.

6.4 **Animaux.** Le Client doit mettre en sécurité tous les animaux dans un endroit sûr, à l'écart des zones de nettoyage, pendant le service. La Société n'est pas responsable des animaux qui s'échappent, deviennent anxieux ou entravent le service.

---

## 7. VERROUILLAGE CHIMIQUE ET PRODUITS

7.1 **Produits approuvés par la Société uniquement.** La Société utilise exclusivement des produits de nettoyage enregistrés dans son système de verrouillage chimique (`chemical-lockout.ts`). Les fiches de données de sécurité (FDS) de tous les produits sont disponibles pour consultation par le Client sur demande.

7.2 **Aucun produit fourni par le Client.** La Société n'utilise aucun produit, outil ou équipement de nettoyage fourni par le Client. Le protocole de verrouillage chimique interdit l'introduction de substances non enregistrées.

7.3 **Allergies et sensibilités.** Le Client peut divulguer des allergies ou sensibilités chimiques connues lors de la réservation. La Société, dans la mesure du possible sur le plan opérationnel, substitue des produits de son catalogue approuvé. Si aucun produit de remplacement approuvé n'est disponible, la Société en avise le Client avant le service.

---

## 8. EXCLUSIONS

8.1 **Les éléments suivants sont explicitement exclus de ce service et du champ d'application du présent contrat :**

| Élément exclu | Motif |
|---|---|
| Risque biologique (sang, liquides corporels, déchets infectieux) | Nécessite une décontamination spécialisée. Niveau IES 5. |
| Moisissures ou champignons | Nécessite un spécialiste certifié en décontamination de moisissures. |
| Infestation de nuisibles ou de rongeurs, excréments ou matériaux de nidification | Nécessite un service de lutte antiparasitaire agréé. |
| Conditions de syllogomanie (accumulation empêchant l'accès aux surfaces) | Risque pour la sécurité; nécessite des services spécialisés. |
| Fenêtres extérieures au-dessus du rez-de-chaussée sans accès sécuritaire | Restriction de sécurité. |
| Déplacement de meubles lourds (>25 kg / 55 lb) | Sécurité biomécanique (`biomechanical-index.ts`). |
| Nettoyage de l'intérieur des appareils électroménagers (four, réfrigérateur, lave-vaisselle) | Couvert uniquement si sélectionné comme supplément payant lors de la réservation. |

Si l'équipe arrive et découvre une condition exclue, la Société en avise immédiatement le Client, suspend le service et fournit une référence à un spécialiste qualifié dans la mesure du possible. Les frais d'annulation tardive (article 4.2) ne s'appliquent pas si le Client ne pouvait raisonnablement pas connaître la condition exclue avant l'arrivée de l'équipe.

---

## 9. RESPONSABILITÉ ET ASSURANCE

9.1 **Couverture d'assurance.** La Société détient une assurance responsabilité civile commerciale et est inscrite auprès de WorkSafeBC (`business-insurance.ts`). Une attestation d'assurance est disponible sur demande.

9.2 **Dommages préexistants.** La Société n'est pas responsable des dommages qui existaient avant le service. L'équipe de nettoyage documente les conditions préexistantes à l'arrivée par l'intermédiaire de la PWA.

9.3 **Dommages accidentels.** Si la Société cause des dommages aux biens du Client pendant le service, la Société en avise immédiatement le Client, documente les dommages par des photos horodatées et répare ou remplace l'article endommagé aux frais de la Société jusqu'à concurrence de la limite de sa couverture d'assurance.

9.4 **Objets de valeur.** Le Client doit mettre en sécurité ou retirer l'argent comptant, les bijoux, les documents sensibles et les autres objets de grande valeur avant le service. La responsabilité de la Société pour la perte d'objets de valeur non sécurisés est limitée au montant recouvrable en vertu de la police d'assurance de la Société.

9.5 **Limitation de responsabilité.** Dans toute la mesure permise par la loi, la responsabilité totale de la Société pour toute réclamation découlant du présent contrat ne dépasse pas le prix total payé par le Client pour le service spécifique à l'origine de la réclamation.

---

## 10. PROTECTION DES RENSEIGNEMENTS PERSONNELS

10.1 **Collecte de renseignements personnels.** La Société recueille les renseignements personnels du Client aux seules fins suivantes : prestation du service (adresse, consignes d'accès), communication (courriel, téléphone pour la planification et les notifications), traitement des paiements (Stripe) et conformité légale (registres de TPS/TVH). Cette collecte est conforme à la *Loi sur la protection des renseignements personnels* (C.-B.) (« PIPA »).

10.2 **Renseignements sensibles.** Les codes d'accès, les codes d'alarme et les renseignements sur les clés sont chiffrés au repos (`crypto.server.ts`) et accessibles uniquement au chef de l'équipe de nettoyage assignée pour la durée du service prévu.

10.3 **Aucune vente ni divulgation non autorisée.** La Société ne vend, ne loue ni ne divulgue les renseignements personnels du Client à des tiers, sauf : (a) si la loi l'exige (p. ex. à l'ARC pour les registres fiscaux), (b) au processeur de paiement de la Société (Stripe) aux seules fins de traitement des paiements, ou (c) à l'équipe de nettoyage assignée aux seules fins de prestation du service.

10.4 **Données photographiques.** Les photos de fin de service sont conservées comme preuves d'assurance qualité. Les photos ne contiennent que les surfaces nettoyées — le système PWA de la Société est configuré pour exclure les visages et les objets personnels du cadre dans la mesure du possible. Les photos sont conservées pendant la durée de la période de garantie et de tout litige en cours.

10.5 **Accès et rectification.** Le Client peut demander l'accès à ses renseignements personnels ou leur rectification par l'intermédiaire du Portail Client ou en contactant `[AGENT_PROTECTION_RENSEIGNEMENTS]`. La Société répond dans les trente (30) jours, conformément à la PIPA.

10.6 **Conservation.** Les renseignements personnels du Client sont conservés pendant sept (7) ans après le dernier service à des fins de registres fiscaux et commerciaux, puis détruits de manière sécuritaire, à moins qu'un litige en cours ou une exigence légale n'en impose une conservation plus longue.

10.7 **Politique de confidentialité.** La politique de confidentialité complète de la Société est publiée sur le site Web de la Société (`/privacy`) et est incorporée par renvoi.

---

## 11. INTÉRÊTS DE RETARD

11.1 **Intérêts sur les sommes en souffrance.** Si une somme due par le Client en vertu du présent contrat demeure impayée pendant plus de trente (30) jours après la date d'échéance, le Client paie des intérêts sur la somme en souffrance au taux de **`[TAUX_INTERET_RETARD]` % par an**, calculés quotidiennement et composés mensuellement, à compter de la date d'échéance jusqu'à la date du paiement intégral.

11.2 **Conformité à la Loi sur l'intérêt.** Le taux d'intérêt annuel indiqué à l'article 11.1 est le taux annuel exprès exigé par l'article 4 de la *Loi sur l'intérêt* (Canada). Aucun intérêt exprimé par jour, par semaine ou par mois ne peut être exigé au-delà de ce taux annuel.

11.3 **Frais de recouvrement.** Le Client rembourse à la Société les frais raisonnables engagés pour le recouvrement des sommes en souffrance, y compris les frais juridiques sur une base procureur-client, dans la mesure permise par la loi.

---

## 12. RÈGLEMENT DES DIFFÉRENDS

12.1 **Résolution interne.** Les Parties tentent de résoudre tout différend découlant du présent contrat par une communication directe. Le Client contacte la Société par l'intermédiaire du Portail Client, par courriel à `[COURRIEL_SOUTIEN]` ou par téléphone au `[TELEPHONE_SOUTIEN]`.

12.2 **Examen fondé sur la preuve.** Tout différend concernant la qualité du service est résolu principalement par référence aux photos horodatées de fin de service prises par l'équipe de nettoyage (article 5.1) et à toute photo soumise par le Client. L'équipe de contrôle de la qualité de la Société émet une décision écrite dans les cinq (5) jours ouvrables.

12.3 **Médiation.** Si la résolution directe et l'examen fondé sur la preuve échouent, les Parties acceptent de participer à une médiation facilitée par un tiers neutre avant d'exercer tout autre recours.

12.4 **Droit applicable.** Le présent contrat est régi et interprété conformément aux lois de la province de la Colombie-Britannique et aux lois fédérales applicables du Canada. Les tribunaux de la Colombie-Britannique ont compétence exclusive.

---

## 13. SIGNATURE ÉLECTRONIQUE ET ACCEPTATION

13.1 **Acceptation lors de la réservation.** Le Client accepte le présent contrat en cliquant sur « Réserver » ou sur un bouton d'acceptation équivalent lors du processus de réservation en ligne. Cette action constitue une signature électronique ayant la même valeur juridique qu'une signature manuscrite.

13.2 **Registre d'acceptation.** La Société enregistre l'acceptation du Client avec les métadonnées suivantes, stockées de manière immuable dans le système : nom du Client, courriel, adresse IP, horodatage de l'acceptation (`consent_accepted_at`) et version exacte du présent contrat acceptée (`consent_tc`). Ce registre sert de piste d'audit pour le présent contrat.

13.3 **Gestion des versions.** La version du présent contrat acceptée par le Client au moment de la réservation est la version qui régit ce service spécifique. Les réservations futures peuvent être régies par des versions mises à jour du présent contrat, que le Client doit accepter à chaque nouvelle réservation.

13.4 **Fournisseur de signature électronique.** Pour les réservations nécessitant une signature électronique officielle (p. ex. B2B, services de grande valeur), la Société utilise un fournisseur de signature électronique conforme à la PIPA (`esignature-provider.ts`). L'acceptation par clic prévue à l'article 13.1 est suffisante pour les réservations de consommateurs.

---

## 14. DISPOSITIONS GÉNÉRALES

14.1 **Intégralité du contrat.** Le présent contrat, ainsi que les documents incorporés par renvoi (Politique d'annulation à `/cancellation` et Politique de confidentialité à `/privacy`), constitue l'intégralité de l'entente entre les Parties relativement au service spécifique identifié à l'article 1 et remplace toutes les discussions, représentations et ententes antérieures, qu'elles soient écrites ou verbales.

14.2 **Absence de renonciation.** Le défaut de l'une ou l'autre des Parties d'appliquer une disposition du présent contrat ne constitue pas une renonciation à cette disposition ni à toute autre disposition.

14.3 **Divisibilité.** Si une disposition du présent contrat est jugée invalide ou inapplicable par un tribunal compétent, les autres dispositions demeurent en vigueur et de plein effet, et la disposition invalide est modifiée dans la mesure minimale nécessaire pour la rendre valide et applicable.

14.4 **Force majeure.** Aucune des Parties n'est responsable du défaut ou du retard d'exécution causé par des événements échappant à leur contrôle raisonnable, y compris, sans s'y limiter : les catastrophes naturelles, les conditions météorologiques extrêmes (`weather-provider.ts`, `weather-exception.ts`), les pandémies, les troubles civils ou les ordonnances gouvernementales. La Partie touchée en avise l'autre rapidement et reprend l'exécution dès que cela est raisonnablement possible.

14.5 **Cession.** Le Client ne peut céder le présent contrat sans le consentement écrit préalable de la Société. La Société peut céder le présent contrat à une entité successeur en cas de fusion, d'acquisition ou de vente de la quasi-totalité de ses actifs.

14.6 **Langue.** Le présent contrat est fourni en anglais et en français. En cas de divergence, la version anglaise prévaut dans la mesure permise par la loi applicable.

---

## ACCEPTATION

**Le Client accepte le présent contrat par voie électronique lors de la réservation :**

- Nom du Client : `[NOM_COMPLET_CLIENT]`
- Courriel du Client : `[COURRIEL_CLIENT]`
- Adresse IP : `[IP_CLIENT]`
- Horodatage de l'acceptation : `[DATE_HEURE_ACCEPTATION]`
- Version du contrat : 0.1 (`consent_tc`)

En cliquant sur « Réserver », le Client reconnaît avoir lu, compris et accepté les conditions du présent contrat, y compris la Politique d'annulation et la Politique de confidentialité incorporées par renvoi.

---

*Ce document est la version 0.1 du Contrat de service client de Lulu Island Flagship (ponctuel). Il s'agit d'une ébauche en attente de révision par un avocat autorisé à exercer en Colombie-Britannique. Le système assure le suivi de l'historique des versions et des métadonnées d'acceptation; aucune version n'est jamais supprimée. Pour la version exécutoire d'une réservation spécifique, consulter le registre d'acceptation associé à cette réservation dans le système de gestion des contrats de la Société.*
