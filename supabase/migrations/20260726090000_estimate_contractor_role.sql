-- EST-E27 : regime de TVA — entreprise principale ou sous-traitance.
--
-- En sous-traitance de travaux immobiliers, la TVA est AUTOLIQUIDEE : le
-- sous-traitant facture hors taxe et le preneur (l'entreprise principale)
-- declare la taxe. Fondement : article 283, 2 nonies du CGI, applicable aux
-- contrats de sous-traitance conclus depuis le 1er janvier 2014. La mention
-- « Autoliquidation » est imposee par le 13° du I de l'article 242 nonies A de
-- l'annexe II au CGI.
--
-- On modelise le ROLE CONTRACTUEL, pas la consequence fiscale : un champ nomme
-- `vat_reverse_charge` figerait le traitement et vieillirait mal si la regle
-- evolue. Le role decrit le fait metier, la TVA en decoule.
--
-- Porte par la VERSION et non par le tenant : une meme entreprise est
-- principale sur un marche et sous-traitante sur le suivant. Un reglage global
-- serait faux la moitie du temps.
--
-- Neutralite : `default 'principal'` reproduit le comportement actuel de toutes
-- les versions existantes. En PostgreSQL 11+, « add column ... not null default »
-- remplit par le catalogue, sans reecriture de table ni UPDATE — donc aucun
-- trigger de ligne, et `updated_at` / journal d'audit des versions scellees
-- restent intacts.
--
-- `guard_estimate_versions_readonly` n'est deliberement PAS etendu a cette
-- colonne : l'y ajouter ferait lever « Estimate version is read-only » sur les
-- versions non-brouillon, ce qui est un changement de comportement. Meme parti
-- pris que pour `calc_engine_version` (20260724090000).

alter table public.estimate_versions
  add column if not exists contractor_role text not null default 'principal';

-- NOT VALID puis VALIDATE : la validation d'une contrainte CHECK prend sinon un
-- verrou ACCESS EXCLUSIVE pendant le scan complet de la table. En deux temps,
-- le scan se fait sous un verrou partage.
alter table public.estimate_versions
  drop constraint if exists estimate_versions_contractor_role_check;
alter table public.estimate_versions
  add constraint estimate_versions_contractor_role_check
  check (contractor_role in ('principal', 'subcontractor'))
  not valid;
alter table public.estimate_versions
  validate constraint estimate_versions_contractor_role_check;

comment on column public.estimate_versions.contractor_role is
  'Role contractuel sur ce devis : principal (TVA normale) ou subcontractor (TVA autoliquidee, art. 283-2 nonies CGI). Choix explicite de l''utilisateur, jamais deduit.';
