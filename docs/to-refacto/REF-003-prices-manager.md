# REF-003 - Decouper PricesManager

- Fichier: `src/components/catalogue/PricesManager.tsx`
- Priorite: P1
- Complexite: L
- Statut: A faire

## Probleme

Le composant fait a la fois chargement Supabase, listing SWR, CRUD, suppression, bulk JSON, integration CSV et affichage des modales.

## Pourquoi il est gros

- Centralisation de presque toute la feature catalogue prix.
- Logique data et presentation fortement entremelées.

## Refacto cible

- Extraire `usePriceLookups`.
- Extraire `useSupplierPricesList`.
- Extraire `PricesTable`, `PriceFormModal`, `DeletePriceModal`, `BulkJsonPanel`.

## Definition of done

- Le composant principal devient un conteneur.
- Les modales et le tableau sont isoles.
- Les flux CRUD et import continuent a fonctionner sans changement UX.
