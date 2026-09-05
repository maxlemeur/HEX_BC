# Changelog

## [0.5.0](https://github.com/maxlemeur/HEX_BC/compare/v0.4.2...v0.5.0) (2026-09-05)


### Features

* harden catalogue and estimate editing ([0fac84e](https://github.com/maxlemeur/HEX_BC/commit/0fac84e67fb392ac213f900ddaa8de60d81d68fa))
* improve estimate editing and catalogue integration ([b09ac57](https://github.com/maxlemeur/HEX_BC/commit/b09ac57a4b1bbc28eef2e22b1e8284f1350b5f5c))
* **ui:** integrer shadcn/ui sur Base UI, socle uniquement ([b4f18f8](https://github.com/maxlemeur/HEX_BC/commit/b4f18f83ca79256d34b5584263b2752592a0c396))

## [0.4.2](https://github.com/maxlemeur/HEX_BC/compare/v0.4.1...v0.4.2) (2026-08-19)


### Bug Fixes

* **ci:** mapper le mode de diff des migrations pour les passes planifiees ([2b6f961](https://github.com/maxlemeur/HEX_BC/commit/2b6f961bd99ba4fc917cc6c199beddb19fcd4731))

## [0.4.1](https://github.com/maxlemeur/HEX_BC/compare/v0.4.0...v0.4.1) (2026-08-19)


### Bug Fixes

* **deploy:** retirer le cron vercel.json qui bloquait tous les deploiements ([1351a52](https://github.com/maxlemeur/HEX_BC/commit/1351a52225fb444715ca5ca77501c6e372a87546))
* **test:** unmount jsdom roots to stop React work after env teardown ([#13](https://github.com/maxlemeur/HEX_BC/issues/13)) ([bca0b05](https://github.com/maxlemeur/HEX_BC/commit/bca0b05053f309f78432ceed5277c772143f6156))

## [0.4.0](https://github.com/maxlemeur/HEX_BC/compare/v0.3.1...v0.4.0) (2026-08-19)


### Features

* **estimates:** govern calculation engine v2 ([5aef76b](https://github.com/maxlemeur/HEX_BC/commit/5aef76b272a92b9e063c2872cc8a9de9bc341640))
* **estimates:** nature de ligne, arrondi commercial et durcissement de l'approbation ([f4f6a70](https://github.com/maxlemeur/HEX_BC/commit/f4f6a70c4cfdc46da057d8de0d8cb2b3dc87768f))
* **quality:** remédier aux 26 postes du registre de dette et durcir les gardes ([bc253a3](https://github.com/maxlemeur/HEX_BC/commit/bc253a33fd0ea6a919ec68d69f5a121bf9c75ee4))
* **takeoff:** strengthen trusted measurement journey ([1c86bbe](https://github.com/maxlemeur/HEX_BC/commit/1c86bbe9b672dd9d6b8c700e7070b625c0b01d75))


### Bug Fixes

* **auth:** unify active tenant boundaries ([9ca80b3](https://github.com/maxlemeur/HEX_BC/commit/9ca80b392e0ecd8a48b154a56bea034cb5feabf3))
* **db:** make local migrations and RLS reproducible ([03e1310](https://github.com/maxlemeur/HEX_BC/commit/03e1310a1f597c7c53032a0d0628435f3ff8f3db))
* **e2e:** send draft lock session UUID on Playwright API mutations ([99f6d14](https://github.com/maxlemeur/HEX_BC/commit/99f6d141c2fd72b9727028b85e962aa551e99218))
* **e2e:** send draft lock session UUID on Playwright API mutations ([507cde2](https://github.com/maxlemeur/HEX_BC/commit/507cde2dc228832873eaf5150a2398c7dc541d4f))
* **estimates:** aligner le payload de version sur le contrat RPC ([758e3a7](https://github.com/maxlemeur/HEX_BC/commit/758e3a7721dd6516e92cd8f4ffebadddb6ce354e))
* **security:** harden document dependencies and E2E credentials ([e93f6bf](https://github.com/maxlemeur/HEX_BC/commit/e93f6bf103e375d0cf90decabdb1713b5fac9192))
* **workflows:** make external effects recoverable ([8d05260](https://github.com/maxlemeur/HEX_BC/commit/8d05260f5f094280a6498ba3947b8d0781dce2db))

## [0.3.1](https://github.com/maxlemeur/HEX_BC/compare/v0.3.0...v0.3.1) (2026-08-08)


### Bug Fixes

* **security:** revoke anonymous structured import execution ([dd7009d](https://github.com/maxlemeur/HEX_BC/commit/dd7009d86084659c7bb08fb1f7b6818daa6ce923))

## [0.3.0](https://github.com/maxlemeur/HEX_BC/compare/v0.2.0...v0.3.0) (2026-08-08)


### Features

* **affaires:** add safe bulk archive and deletion ([37d796d](https://github.com/maxlemeur/HEX_BC/commit/37d796dae81952088bb9284f2e9372228bce78c5))

## [0.2.0](https://github.com/maxlemeur/HEX_BC/compare/v0.1.0...v0.2.0) (2026-08-08)


### Features

* **app:** display application version ([0f5e72f](https://github.com/maxlemeur/HEX_BC/commit/0f5e72f0f008749dfe7d91ac0cb3b8991f5e13d1))
* **imports:** preserve structured DPGF hierarchy ([f6402d4](https://github.com/maxlemeur/HEX_BC/commit/f6402d49486b98dcb720325e99122fd5b8326eda))


### Bug Fixes

* **app:** keep application version visible ([8f0caa0](https://github.com/maxlemeur/HEX_BC/commit/8f0caa0da25fc30927b061e1d91d36363d4895ed))
