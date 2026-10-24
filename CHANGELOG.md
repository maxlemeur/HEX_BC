# Changelog

## [0.6.0](https://github.com/maxlemeur/HEX_BC/compare/v0.5.1...v0.6.0) (2026-10-24)


### Features

* **affaires:** import Google Drive files into affaire intake (TI-652) ([981b5c2](https://github.com/maxlemeur/HEX_BC/commit/981b5c2f5bd946b2cffc8b9673499082b6deaaee))
* **affaires:** import Google Drive files into affaire intake (TI-652) ([4352acd](https://github.com/maxlemeur/HEX_BC/commit/4352acd5c8938fbd8b7ace7a64da31753f042ced))
* **affaires:** open v3 templates and show v3 hub margins (lot 3.2) ([aea69b5](https://github.com/maxlemeur/HEX_BC/commit/aea69b57e4606fc9c72423cf246a51f669a61825))
* **affaires:** open v3 templates and show v3 hub margins (lot 3.2) ([6f62a44](https://github.com/maxlemeur/HEX_BC/commit/6f62a448ac9a700ebab14ab0a06527b6274fda80))
* **ai:** connect local ChatGPT plan to AI workflows ([76107d0](https://github.com/maxlemeur/HEX_BC/commit/76107d0ceb8af9df542319445b626e815e906f12))
* **estimates:** add the automatic FO provision to engine 3 lines (TI-534) ([d6bf94b](https://github.com/maxlemeur/HEX_BC/commit/d6bf94b59fa4d7ddd741f907c2aa6a6e3fd85dab))
* **estimates:** automatic FO provision on engine 3 lines (TI-534, lot 1) ([f293ea5](https://github.com/maxlemeur/HEX_BC/commit/f293ea5eae3d7ad473464739c115168b67e6f190))
* **takeoff:** choose AI provider and verify real PDF extraction ([354c18a](https://github.com/maxlemeur/HEX_BC/commit/354c18ada009ead41b22ab2cceac852a077af229))
* **takeoff:** use local ChatGPT plan for extraction ([2f5c4eb](https://github.com/maxlemeur/HEX_BC/commit/2f5c4ebaee1286a6486f80b25afd589c37804520))
* **ui:** animate import completion and takeoff steps ([b412c2a](https://github.com/maxlemeur/HEX_BC/commit/b412c2a3d1169f1bad894796561cd6c3748ee4cd))


### Bug Fixes

* **affaires:** accept intake deadlines given to the minute ([5c5e718](https://github.com/maxlemeur/HEX_BC/commit/5c5e718fde0259a2e9bc7454c369a3615a4bb703))
* **affaires:** chart a current issued v3 at its frozen margin ([a0ca443](https://github.com/maxlemeur/HEX_BC/commit/a0ca4431be1acfb8d9ae940203639be7fc177ffa))
* **affaires:** import a Drive selection as one intake upload (TI-652) ([acfdcf9](https://github.com/maxlemeur/HEX_BC/commit/acfdcf9ebc3206f2a0d2a9ce6a363442465de046))
* **affaires:** keep the Drive panel open after a partial import failure (TI-652) ([9c882ed](https://github.com/maxlemeur/HEX_BC/commit/9c882eda930773b06d124a00daa80d6b8b80f57f))
* **ai:** repair local ChatGPT sign-in and streamed replies ([0c4a941](https://github.com/maxlemeur/HEX_BC/commit/0c4a941a9ada2f5ca56273bef16d67ce8e6295a3))
* **auth:** secure session refresh and restrict membership lookup ([b6a5fad](https://github.com/maxlemeur/HEX_BC/commit/b6a5fad9afdbc9ae6d6bdd56651f61e77feb07a4))
* **backup:** activate encrypted exports with dedicated role ([d5d9dfa](https://github.com/maxlemeur/HEX_BC/commit/d5d9dfa952d0d3e1bc82c9b107d94ccf2fbe3bca))
* **ci:** read the RLS matrix report from an explicit Vitest file ([c6825a8](https://github.com/maxlemeur/HEX_BC/commit/c6825a88b25dc0f60bf9992018632743e83a6246))
* **ci:** update native Supabase runtime and port allocation ([e0002bc](https://github.com/maxlemeur/HEX_BC/commit/e0002bc890812c4cb649f661346e41d20f7cf5e2))
* **dashboard:** avoid financial reads for recent metadata ([ec3cb48](https://github.com/maxlemeur/HEX_BC/commit/ec3cb48e39218d9639b5749ba4aa2cc7c476a147))
* **deps:** update undici and postal-mime past the new audit advisories ([78ce02d](https://github.com/maxlemeur/HEX_BC/commit/78ce02d4d56f1c8d3a14b5e7799b336d29e9533d))
* **deps:** update undici and postal-mime past the new audit advisories ([ae33e71](https://github.com/maxlemeur/HEX_BC/commit/ae33e71dd101ae787a484f616c0114f360e12130))
* **deps:** update undici and postal-mime past the new audit advisories ([69f7db0](https://github.com/maxlemeur/HEX_BC/commit/69f7db0ed00a04a5782148a09081938639d0c603))
* **e2e:** avoid blocking macOS supervisor inspection ([9a98331](https://github.com/maxlemeur/HEX_BC/commit/9a983312cb382c1a7b20755c23181e5f90aa4cf1))
* **e2e:** preserve worker diagnostics and supervisor isolation ([b40008c](https://github.com/maxlemeur/HEX_BC/commit/b40008c154ffb707c8e8fac07bab2f9f10ecaa0a))
* **e2e:** qualify business fixtures and hydration boundaries ([39d84ec](https://github.com/maxlemeur/HEX_BC/commit/39d84ec9ba21fb6020f84be2da7d5c8ec68ee958))
* **e2e:** retain browser diagnostics and count native stacks once ([97142b2](https://github.com/maxlemeur/HEX_BC/commit/97142b252c82f9cb4b3265578f591fab457a71a9))
* **editor:** cancel abandoned suggestion learning reads ([b1db089](https://github.com/maxlemeur/HEX_BC/commit/b1db089bb68e8045a370e6f1e79dbd561baf710b))
* **editor:** recover deleted rows before completing undo ([#87](https://github.com/maxlemeur/HEX_BC/issues/87)) ([1fc25fa](https://github.com/maxlemeur/HEX_BC/commit/1fc25fa983ae0b134bbf1b6ea27cc0e496318765))
* **editor:** stop reporting learning reads cancelled by a reload ([74b758a](https://github.com/maxlemeur/HEX_BC/commit/74b758a8d9b084783b5b5be1fe6467d167af7404))
* **estimates:** check version item access once per read, not per item ([922f1cf](https://github.com/maxlemeur/HEX_BC/commit/922f1cfb8507a5ff1c7d3d4c6d7b4d6b1b07e163))
* **estimates:** check version item access once per read, not per item ([0186a51](https://github.com/maxlemeur/HEX_BC/commit/0186a512cefd15d36d1ab6bed699488e04ceec9d))
* **estimates:** keep a unit typed before a new line gets its id ([285d934](https://github.com/maxlemeur/HEX_BC/commit/285d9345fdb578b900b9ff06a38a7f21aca363d8))
* **estimates:** keep the live FO provision when undoing unrelated edits ([8a49074](https://github.com/maxlemeur/HEX_BC/commit/8a4907452a516e2d23ce28eef8ca9fe7bbb014b6))
* **estimates:** re-derive the FO provision of recovered Type FO edits ([63bdfda](https://github.com/maxlemeur/HEX_BC/commit/63bdfda79a66863b3bdfe0b1e6633036b6e48915))
* **estimates:** take the stored FO provision back after a buffered save ([6d4b1a9](https://github.com/maxlemeur/HEX_BC/commit/6d4b1a9ec8348173e9071ab67b47fa1db171d33d))
* **exports:** deliver PDFs and avoid impossible supplier lookups ([2f41de4](https://github.com/maxlemeur/HEX_BC/commit/2f41de4db5ba3d3e27ec1ff95eff724744fbc532))
* **lot3-3.1:** keep the source order of a selected sub-section ([7dcc2ff](https://github.com/maxlemeur/HEX_BC/commit/7dcc2ff704b470830e3f7899851a4f4e1257cabf))
* **openapi:** drop Zod check names leaked as JSON Schema formats ([70a5cca](https://github.com/maxlemeur/HEX_BC/commit/70a5cca81f394c3db91593e6d4d8aaa6272d628a))
* **operations:** harden backup and email recovery ([d4d467e](https://github.com/maxlemeur/HEX_BC/commit/d4d467e8a0976797ae6a9f7717c4ea13efa47ee2))
* **pdf:** avoid stale connections after CPU rendering ([c13999f](https://github.com/maxlemeur/HEX_BC/commit/c13999f25fbd0fe54019b02571cceed9b1b6c13a))
* **pdf:** include runtime fonts in production functions ([bee0163](https://github.com/maxlemeur/HEX_BC/commit/bee01639bb23d61d258dfc588b7d4b4937fcd9b4))
* **perf:** eliminate remaining bulk CSV catalogue queries ([11bb9b9](https://github.com/maxlemeur/HEX_BC/commit/11bb9b9a64d1071c07f02076ee65de3242d500a0))
* **performance:** remove editor stalls and paginate orders ([cf4b6a0](https://github.com/maxlemeur/HEX_BC/commit/cf4b6a08d23708acdb0d0d6f6c73325fbb7b6bb9))
* **perf:** paginate large PDFs once and load full hub structure ([f1aa485](https://github.com/maxlemeur/HEX_BC/commit/f1aa485004accb02c381b32bea0dc41d90797964))
* **perf:** scope estimate provenance reads to the version ([2159f1b](https://github.com/maxlemeur/HEX_BC/commit/2159f1b22b00cfc86db59304fac740ff8e7e414c))
* **security:** harden takeoff, CSV exports and backups ([1914b78](https://github.com/maxlemeur/HEX_BC/commit/1914b7800607d322e728b74c38930e11802eac64))
* **security:** recover CSV and takeoff admission protections ([9c2a811](https://github.com/maxlemeur/HEX_BC/commit/9c2a811873234a8b83dbf1f796e5f02a812328ee))
* **security:** revoke anonymous execute on security definer functions ([d8715ed](https://github.com/maxlemeur/HEX_BC/commit/d8715edcdc137f1c2d80990badc9d8581a2c079a))
* **security:** revoke anonymous execute on security definer functions ([9579aad](https://github.com/maxlemeur/HEX_BC/commit/9579aadc373dd0f9d16881410533e5af75d7b967))
* **security:** revoke public execute on template insertion ([1499ac0](https://github.com/maxlemeur/HEX_BC/commit/1499ac0897bd9ccdd32ddb9eef413aa237812736))
* **security:** revoke public execute on template insertion ([a8b813f](https://github.com/maxlemeur/HEX_BC/commit/a8b813f7c24c709197eb4167bc2ce6a6c5106c4a))
* **security:** update Node and Next.js patches ([85d476f](https://github.com/maxlemeur/HEX_BC/commit/85d476ff4ce59c6f46d036749a56f23e4f8adbc3))
* **takeoff:** reuse comparison sources for the risk radar ([898bc56](https://github.com/maxlemeur/HEX_BC/commit/898bc566f87c9b5072656c1cea582b5e633e3530))
* **takeoff:** select the columns the DPGF and risk reads order by ([6c62c9e](https://github.com/maxlemeur/HEX_BC/commit/6c62c9ea638587c424c9eb7946796a0b12fb8a59))
* **takeoff:** show recovery only for eligible jobs ([6796836](https://github.com/maxlemeur/HEX_BC/commit/67968363ae2f83af6534379a7ff30cc72e6dfafd))
* **testing:** preserve validated fixture environment ([9ee18ca](https://github.com/maxlemeur/HEX_BC/commit/9ee18ca8187d1e4f76e8b196be90d85e2fa1334b))
* zod 4.6 follow-ups for OpenAPI formats and intake deadlines ([83530a1](https://github.com/maxlemeur/HEX_BC/commit/83530a171fd4e532438e5e1222a49beed3ec9245))


### Performance Improvements

* **exports:** bound concurrent reads for large estimates ([77340b1](https://github.com/maxlemeur/HEX_BC/commit/77340b18c12f56a017ec099e00546349591c5504))
* **lot3-3.1:** write v3 copies in one insert and read only the copied subtrees ([994195d](https://github.com/maxlemeur/HEX_BC/commit/994195d6996a2e260659d7836acf0a43ceeecb97))

## [0.5.1](https://github.com/maxlemeur/HEX_BC/compare/v0.5.0...v0.5.1) (2026-10-19)


### Bug Fixes

* **affaires-hub:** keep the full hub once any version of the affaire has a line ([17a54d7](https://github.com/maxlemeur/HEX_BC/commit/17a54d79fb2edede3ebc8fc5d4ddd5d17cd32416))
* **affaires-hub:** keep the full hub once any version of the affaire has a line ([54cab04](https://github.com/maxlemeur/HEX_BC/commit/54cab0408f28065c9f8b86ca78663b4d85b55407))
* **estimates:** copy ~1 000 items into a v1/v2 draft in one statement ([d90e158](https://github.com/maxlemeur/HEX_BC/commit/d90e158df0aea23cb12dfe509f912497f691851e))
* **estimates:** offer every source version in the import dialog ([7e8d79d](https://github.com/maxlemeur/HEX_BC/commit/7e8d79de7e9c79ca44f39e8ce9c4d69a882f5278))
* **estimates:** reorder and move ~1 000 siblings within the API timeout ([0163e7c](https://github.com/maxlemeur/HEX_BC/commit/0163e7cf83b97a6aadcf1c19130c8cd936ffb5c9))
* **estimates:** reorder and move ~1 000 siblings within the API timeout ([ef6d61b](https://github.com/maxlemeur/HEX_BC/commit/ef6d61b340fcd735b9b0a437b08502be579e1409))

## [0.5.0](https://github.com/maxlemeur/HEX_BC/compare/v0.4.2...v0.5.0) (2026-10-18)


### Features

* **lot2-2.10a:** chaque création annonce son moteur et crée une v3 sous politique 3 ([59b3b6b](https://github.com/maxlemeur/HEX_BC/commit/59b3b6bf9ba268c63e5bc8e7f7a2f250e0bded93))
* **lot2-2.10a:** make every creator ready for the tenant's engine 3 ([661e257](https://github.com/maxlemeur/HEX_BC/commit/661e257eed44b8f5036bff7ac3375f36556fd742))
* **lot2-2.10b:** bascule M8, une nouvelle estimation est en moteur 3 sans politique de tenant ([56de5b1](https://github.com/maxlemeur/HEX_BC/commit/56de5b1d05ff0b3e31bc287bd3cefdc2a1e693a2))
* **lot2-2.10b:** new estimates are engine 3 without a tenant policy (M8) ([6aa1ed3](https://github.com/maxlemeur/HEX_BC/commit/6aa1ed315a541fe504e3cda45af6edd7d411b438))
* **lot2-2.5:** persist, freeze and govern engine 3 versions behind the tenant policy ([94694ab](https://github.com/maxlemeur/HEX_BC/commit/94694ab340020aa31dfdb6acbbf7549c20957ab5))
* **lot2-2.6:** edit engine 3 estimates in the grid and settings ([da462ac](https://github.com/maxlemeur/HEX_BC/commit/da462ac4622893c9d8287e4c56eaa9048eba20e5))
* **lot2-2.6:** open the editor on a v3 draft with the v3 grid, footer, sync, preselection and read-only pages ([d97107a](https://github.com/maxlemeur/HEX_BC/commit/d97107a75896cebce2a24187cdeddda9a3b1204f))
* **lot2-2.6:** v3 settings payload, settings hook and settings section with VAT propagation ([e0022a1](https://github.com/maxlemeur/HEX_BC/commit/e0022a1f967330b8e827d3317f1797d2c3729045))
* **lot2-2.7:** admit the client contract 2 for engine 3 emission (M5) ([af70813](https://github.com/maxlemeur/HEX_BC/commit/af70813438514467e58bddb70eb302354e07b6ff))
* **lot2-2.7b:** export the CSV and the BDC V1.1 of an engine 3 estimate from its document ([37758c3](https://github.com/maxlemeur/HEX_BC/commit/37758c32a504846157d9133592a2fc61b7a25cbb))
* **lot2-2.7b:** exporter le CSV et le BDC V1.1 d'un devis moteur 3 depuis son document ([7226e3a](https://github.com/maxlemeur/HEX_BC/commit/7226e3a7571b4ff78398894133bd8643a07a4ac0))
* **lot2-2.7:** issue a v3 under client contract 2 and seal payload 6 ([71d04e0](https://github.com/maxlemeur/HEX_BC/commit/71d04e0394019f4c593d2df723ccb75bb4765209))
* **lot2-2.7:** issue engine 3 estimates with client contract 2 and seal payload 6 ([b905ca2](https://github.com/maxlemeur/HEX_BC/commit/b905ca26b405ef734de3bdae14acda139f128bc2))
* **lot2-2.8b:** copy sections and the linked DPGF into a v3 through the batch writer ([22c4e80](https://github.com/maxlemeur/HEX_BC/commit/22c4e807a7f460021e15ac87bf556fa134167f58))
* **lot2-2.8b:** les copies entrent dans une v3 par l'écrivain de lot (DPGF lié, sections, conversion refusée) ([8f7183a](https://github.com/maxlemeur/HEX_BC/commit/8f7183ab22c6a51e2fede89adfd0b37fcf0048df))
* **lot2-2.8:** chemins d'entrée du moteur 3 (M6, M6b) ([5cfd4a9](https://github.com/maxlemeur/HEX_BC/commit/5cfd4a94215975f3caa122ff5f64e1192b60cc5f))
* **lot2-2.8:** import and paste OPTIMA into engine 3 ([5348b67](https://github.com/maxlemeur/HEX_BC/commit/5348b672e8a8b1bd7d85f3718fdde38a7c5b36f6))
* **lot2-2.8:** insert library assemblies and templates into a v3 ([8f4c28d](https://github.com/maxlemeur/HEX_BC/commit/8f4c28d196356b0e1b4e020456ccfca0b40ac9d8))
* **lot2-2.8:** M6 engine 3 entry paths for templates, assemblies and generated ouvrages ([ef96753](https://github.com/maxlemeur/HEX_BC/commit/ef96753c9812723c42ccd2bbe02998728862a31b))
* **lot2-2.8:** named v3 refusals for section import, AI structure and version zero ([c08978b](https://github.com/maxlemeur/HEX_BC/commit/c08978b2288427af602999735d26e45b599ecae6))
* **lot2-2.8:** paste into a v3 through the v3 batch writer (rule 2) ([f00da33](https://github.com/maxlemeur/HEX_BC/commit/f00da33bb8913a403c604dcc4e89e01204f82b59))
* **lot2-2.9:** order supplier offers in their purchase unit ([78ca085](https://github.com/maxlemeur/HEX_BC/commit/78ca0855350e18a86eed25f4b15183349f47bf39))
* **lot2-2.9:** order supplier offers in their purchase unit and share the unit referential ([85b0b52](https://github.com/maxlemeur/HEX_BC/commit/85b0b52a58f0bec906b23c49fbdf7267393a8497))
* **supabase:** restamp a branch migration after the base newest before merge ([1f0f4ec](https://github.com/maxlemeur/HEX_BC/commit/1f0f4ec85c888d1bf35c6a1ca0829f9e3012ad5e))


### Bug Fixes

* **army:** fail closed on journeys the local selection silently drops ([e4e3885](https://github.com/maxlemeur/HEX_BC/commit/e4e3885f467c2e452436876f18737835c4cce6d7))
* **army:** fail closed on journeys the local selection silently drops ([4624d43](https://github.com/maxlemeur/HEX_BC/commit/4624d4349b79b08674edbf276ce48f11b75d9d4b))
* **catalogue:** keep the supplier CSV import mounted while lookups load ([7393d94](https://github.com/maxlemeur/HEX_BC/commit/7393d9410a4067ecf0829005e7b1916be944c74a))
* **catalogue:** surface supplier CSV lookup load failures and block the analysis ([608c40a](https://github.com/maxlemeur/HEX_BC/commit/608c40aa04ca9329a9d5c79ed4de861a2d1be504))
* **catalogue:** surface supplier CSV lookup load failures and block the analysis ([12d4fe8](https://github.com/maxlemeur/HEX_BC/commit/12d4fe8483c2339642416b2b9d2f51038b8655de))
* **ci:** read a single unit's flat artifact download in the Army aggregate ([7a9d67d](https://github.com/maxlemeur/HEX_BC/commit/7a9d67d037a5405eb8b1e38f3092e7caa116f907))
* **ci:** run every takeoff journey when a pull request reaches every critical journey ([d06df97](https://github.com/maxlemeur/HEX_BC/commit/d06df972ac6e5ac1ee0546c315d478ebac35c995))
* **e2e:** compare resolved paths when the dev loop finds its stack and supervisor ([78533fe](https://github.com/maxlemeur/HEX_BC/commit/78533fe50f74dd6e5e78613267199eec23dcecef))
* **e2e:** compare resolved paths when the dev loop finds its stack and supervisor ([050d161](https://github.com/maxlemeur/HEX_BC/commit/050d161d3250ee1c102bba4565904b3c5f1b6727))
* **e2e:** refuse a journey filter in the dev-loop supervisor entry again ([daa14ed](https://github.com/maxlemeur/HEX_BC/commit/daa14ed37ab8ed75944f9999f8a456a7e32a78be))
* **estimates:** address review of the bounded read ([cf0ef49](https://github.com/maxlemeur/HEX_BC/commit/cf0ef4967d9c870f9cc4dc4b5dbce4cf5de1b692))
* **estimates:** close the bulk and suggestion undos once settings are saved ([88854fc](https://github.com/maxlemeur/HEX_BC/commit/88854fcb997762603895890f416723cf4d2b3ddc))
* **estimates:** hold the bulk-suggestion undo until the new gating answers ([1939dc7](https://github.com/maxlemeur/HEX_BC/commit/1939dc7b85ab79e0e1f75ebb43da53540467d735))
* **estimates:** keep a v3 structural write from raising the totals-not-saved alert (V3E05) ([d48aed2](https://github.com/maxlemeur/HEX_BC/commit/d48aed2747d21d122f7dd1228347838fd49cd1e5))
* **estimates:** keep focus on the active cell's editor when a pending grid render runs (V3E01) ([d7e672b](https://github.com/maxlemeur/HEX_BC/commit/d7e672b43d9e830c9e727fdfc8bac443918dc8a2))
* **estimates:** keep focus on the active cell's editor when a pending grid render runs (V3E01) ([989d837](https://github.com/maxlemeur/HEX_BC/commit/989d8372a1a51aafcf1898f3e2031ddc0807093b))
* **estimates:** keep the bulk move written without version totals ([db968ff](https://github.com/maxlemeur/HEX_BC/commit/db968ffe4e6f23723cf93c4608785d85543769a7))
* **estimates:** keep the bulk-suggestion undo clickable after the apply ([11534e3](https://github.com/maxlemeur/HEX_BC/commit/11534e346c804db1149e4ef9c11aaf4bb6d05119))
* **estimates:** no false totals alert while a v3 undo of a deletion reorders (V3E05) ([ced6121](https://github.com/maxlemeur/HEX_BC/commit/ced6121c76c7896f510273d0d9edd16d911f6523))
* **estimates:** persist version totals after bulk actions and suggestions ([7c66831](https://github.com/maxlemeur/HEX_BC/commit/7c66831b8974d0ac71319d6f939887abece3f8e1))
* **estimates:** persist version totals with the bulk editor actions ([4f67099](https://github.com/maxlemeur/HEX_BC/commit/4f670996879d24c6ad1630713cf075813defc5d6))
* **estimates:** persist version totals with the supplier preselection ([fc2ba2d](https://github.com/maxlemeur/HEX_BC/commit/fc2ba2dcdbe2df97145205362eab6a94d88ca581))
* **estimates:** persist version totals with the supplier preselection ([0bc35c4](https://github.com/maxlemeur/HEX_BC/commit/0bc35c469814f0bf5f0b53de81ea9b90df39b56a))
* **estimates:** pin v1/v2 copy reads to the version read with their access ([f38958c](https://github.com/maxlemeur/HEX_BC/commit/f38958c9e77d36f66d6bf65085b34ea99d80e965))
* **estimates:** read every item and DPGF row when copying into a v1/v2 ([b4b0c72](https://github.com/maxlemeur/HEX_BC/commit/b4b0c72231298c77d90170993029b447cdfd6dba))
* **estimates:** read every item when copying sections into a v1/v2 ([13c697b](https://github.com/maxlemeur/HEX_BC/commit/13c697b5603ff12d25b8852d925496e102630b10))
* **estimates:** read item provenance in bounded in() chunks ([63f7b92](https://github.com/maxlemeur/HEX_BC/commit/63f7b927dbcc580c62b5eeff87c02d52348eb36c))
* **estimates:** read item provenance in bounded in() chunks (60 s read stall) ([1c49835](https://github.com/maxlemeur/HEX_BC/commit/1c49835c4c63299c06b463379cc927cef2d80937))
* **locks:** serialise draft lock acquisition with the forced takeover ([59a7402](https://github.com/maxlemeur/HEX_BC/commit/59a740273cea8016dd1455721bb231985770f118))
* **lot2-2.10a:** keep the v3 margin notice when no analysis computes ([bd75279](https://github.com/maxlemeur/HEX_BC/commit/bd75279549fd5bce378e1e270b9ea5ef271e6a49))
* **lot2-2.10a:** l'avis de marge indisponible s'affiche aussi pour une v3 sans section ([51bce77](https://github.com/maxlemeur/HEX_BC/commit/51bce775ae2b3959a087e4a9a31d50c536faebf9))
* **lot2-2.10a:** refuse a v3 takeoff source before copying it ([017172f](https://github.com/maxlemeur/HEX_BC/commit/017172fabcc32b8251dbd779fd167efbb1f65b06))
* **lot2-2.5:** close the review defects on v3 creation, deletion, freeze and hub margin ([f1d9421](https://github.com/maxlemeur/HEX_BC/commit/f1d9421380d01cd2ca7dec89d001c6599a788294))
* **lot2-2.5:** give a version created with content the section depth it needs ([aba2a74](https://github.com/maxlemeur/HEX_BC/commit/aba2a74e6337da7cbda9b6a4469e69126d162ed0))
* **lot2-2.5:** keep a duplicated v3's relative line id order so its stored amounts stay the engine's ([3e4a38e](https://github.com/maxlemeur/HEX_BC/commit/3e4a38e76bbe78e97d385a70f7448fbf44c05fec))
* **lot2-2.5:** name the shared-base section payload variant in the M4 preflight ([c14b243](https://github.com/maxlemeur/HEX_BC/commit/c14b243d52ed325eb017d8a8d81343e3c79d8490))
* **lot2-2.5:** refuse a direct v3 line delete outside the writer contract and keep the inherited section depth ([f9d5a0b](https://github.com/maxlemeur/HEX_BC/commit/f9d5a0b5acf2db7671ae7ec09f4224aa62be84a2))
* **lot2-2.6b:** a one-line rule suggestion keeps a chosen v3 unit; table back under its budget ([706cc62](https://github.com/maxlemeur/HEX_BC/commit/706cc62fc057dd767f46015313546c1d73dd106d))
* **lot2-2.6b:** a v3 status line raises no quality flag, the risk radar reads its status, the phone list shows v3 units ([3eda121](https://github.com/maxlemeur/HEX_BC/commit/3eda121564b7e6d64f2c0c7d7e2592340735160c))
* **lot2-2.6b:** keep the 2.6 suggestion eligibility of v3 lines ([f7d5fde](https://github.com/maxlemeur/HEX_BC/commit/f7d5fde5e71b351905f9562819543af91d3d39fb))
* **lot2-2.6b:** status lines, phone editor, draft restore and rule units on a v3 ([41533b6](https://github.com/maxlemeur/HEX_BC/commit/41533b6200ddf296fd63eecfd4816c5d2003032f))
* **lot2-2.6:** close PDF and template by name on a v3 draft's detail page (F26-30) ([6c64608](https://github.com/maxlemeur/HEX_BC/commit/6c6460801825c1174d8dd32a83d74f4854ddb20a))
* **lot2-2.6:** format the v3 detail headline totals in the version currency ([e589b37](https://github.com/maxlemeur/HEX_BC/commit/e589b37bce6dbfeffd9aa0a304588b1113b83e63))
* **lot2-2.6:** judge and price a v3 line's supplier comparison in its unit_code ([c8c750f](https://github.com/maxlemeur/HEX_BC/commit/c8c750f35588a756184db74c1a08aebeb70c48c1))
* **lot2-2.6:** keep the v1/v2 margin tier manager out of a v3 draft's settings drawer ([ed93d1f](https://github.com/maxlemeur/HEX_BC/commit/ed93d1fd10435b524cb4dac817ddc43a9bf684dd))
* **lot2-2.6:** let the v3 batch writer bring a non-priced line back to "Chiffrée" ([3cbc122](https://github.com/maxlemeur/HEX_BC/commit/3cbc1221e7823b2f53017f564240dcbf74d087e7))
* **lot2-2.6:** read a v3 line's margin columns in the engine and judge its article association in unit_code (F26-24, F26-26) ([9f47fc9](https://github.com/maxlemeur/HEX_BC/commit/9f47fc93d458bcb23e80e4938d99c66d0040ccb8))
* **lot2-2.6:** refuse a catalogue price in another unit for a v3 line even without a supplier offer (F26-26) ([1c16ad4](https://github.com/maxlemeur/HEX_BC/commit/1c16ad40449f96dd3595b8d4d9c68f0510d8afbc))
* **lot2-2.6:** refuse a designation suggestion priced in another unit on a v3 line even without an offer ([0842ea4](https://github.com/maxlemeur/HEX_BC/commit/0842ea4dcfa9b8acca816e030dbd390049555c3d))
* **lot2-2.6:** refuse an unknown v3 unit without trapping the focus in its cell (F26-10) ([a15cc43](https://github.com/maxlemeur/HEX_BC/commit/a15cc432f63519fd1113061b10cfa37cae5fd1c9))
* **lot2-2.6:** send the v3 grid's deletes, bulk edits, suggestions and recreations through the v3 batch writer (F26-21, F26-22, F26-23, F26-25, F26-31, F26-32) ([ae53f15](https://github.com/maxlemeur/HEX_BC/commit/ae53f15013124aeb141cd5b91bd879b24923102b))
* **lot2-2.6:** show the v3 detail version history in each version's currency ([f6e5ae3](https://github.com/maxlemeur/HEX_BC/commit/f6e5ae34a8c9f78f97d08a0c596fd75c73b01e29))
* **lot2-2.6:** stamp the v3 repricing migration in UTC ([6632a16](https://github.com/maxlemeur/HEX_BC/commit/6632a160a1086f5895f14e88923c04efcfd9b8ee))
* **lot2-2.6:** v3 settings ask the VAT question on every save path, read 0 % as no discount and keep a stored rounding step (F26-27, F26-28, F26-29) ([b86a76f](https://github.com/maxlemeur/HEX_BC/commit/b86a76faebc41e54daaf37cf93984885868f249b))
* **lot2-2.7:** admit the calc-v3 sandbox terms on the owned stack only ([3f390d8](https://github.com/maxlemeur/HEX_BC/commit/3f390d8e476854a93ba68e2c307486c3e35b9a50))
* **lot2-2.7b:** read the atelier/chantier labour split of a v3 as the engine priced it in the CSV and BDC ([324c440](https://github.com/maxlemeur/HEX_BC/commit/324c4408f754489656e17723e056992a0bdcb19a))
* **lot2-2.7:** declare the v3 DPGF export as an import profile ([a242377](https://github.com/maxlemeur/HEX_BC/commit/a242377724aae86819ba1e7750b38e2135456595))
* **lot2-2.7:** format v3 workbook amounts and DPGF amount headers in the version currency ([f8c12cd](https://github.com/maxlemeur/HEX_BC/commit/f8c12cde441a7fde776137a984e29704f4481169))
* **lot2-2.7:** keep non-priced v3 lines non-billable when their exports are re-imported ([48c39ce](https://github.com/maxlemeur/HEX_BC/commit/48c39cef03df8afada3558fec34ce1f42021ce0e))
* **lot2-2.7:** keep the send-blocked alert in place while the send gating is rechecked ([7fa2746](https://github.com/maxlemeur/HEX_BC/commit/7fa27468de6c4800ac7cb2608cab61cc2c7d6746))
* **lot2-2.7:** keep the version VAT rate in a contract 2 header without priced lines ([3a8e576](https://github.com/maxlemeur/HEX_BC/commit/3a8e576a9581b76333679a513b4e4932816ceccc))
* **lot2-2.7:** match the client contract 2 to the canonical row order and section numbering ([238a5e4](https://github.com/maxlemeur/HEX_BC/commit/238a5e40bca51cc1836f0bc86fecfeb91e921176))
* **lot2-2.7:** name an issued v3 copy the strict parser refuses on the print page ([b824631](https://github.com/maxlemeur/HEX_BC/commit/b82463194448c40403ad6cadfc8c7961cf98cf5f))
* **lot2-2.7:** never re-persist the approval summary of an issued version ([e4fc30c](https://github.com/maxlemeur/HEX_BC/commit/e4fc30cff1a5d624e3df9c6ab32bce6d68453fe1))
* **lot2-2.7:** open on the v3 detail page and editor the PDF, emission and seal that 2.7 opens ([7418afc](https://github.com/maxlemeur/HEX_BC/commit/7418afcb5040a208480e6ddd1ad47470ed2d7402))
* **lot2-2.7:** open the v3 editor's Excel and DPGF exports and keep only CSV and BDC closed (P-20) ([0bf43c0](https://github.com/maxlemeur/HEX_BC/commit/0bf43c02884b5fb7d0ab108c533f94615d4d98bc))
* **lot2-2.7:** print an issued v3 from its captured client contract 2 ([427e714](https://github.com/maxlemeur/HEX_BC/commit/427e714e011854cc5cefecc7c898c673923b66ea))
* **lot2-2.7:** print an issued v3 under its sealed layout ([bed1513](https://github.com/maxlemeur/HEX_BC/commit/bed15133241927c96a6ea408078b057bf4e195b9))
* **lot2-2.7:** print an issued v3 with the CGV of its sealed copy ([91299ad](https://github.com/maxlemeur/HEX_BC/commit/91299adf9b825eac020fed0c2cf4344490086041))
* **lot2-2.7:** refuse by name the preview of a v3 draft with a unit-less priced line ([5e750c3](https://github.com/maxlemeur/HEX_BC/commit/5e750c378306d2eeaf686e03aa0b328f6ec541ed))
* **lot2-2.7:** style the contract 2 portal footer from its v3 emphasis ([88ebd56](https://github.com/maxlemeur/HEX_BC/commit/88ebd56e761863a94696deb5cb48645b9f6b160d))
* **lot2-2.7:** une v3 émise s'imprime sous sa mise en page scellée et le contrat client 2 respecte l'ordre de l'arbre ([953c26f](https://github.com/maxlemeur/HEX_BC/commit/953c26f7a76396f1f4cdbf77ee5e9f91b6026dd2))
* **lot2-2.8:** address the independent review of the v3 entry paths ([c28866e](https://github.com/maxlemeur/HEX_BC/commit/c28866e4bfeb689ea4e00947bf61ef7293dd8a3e))
* **lot2-2.8b:** check the depth of a creations-only batch against stored ancestors ([6913164](https://github.com/maxlemeur/HEX_BC/commit/6913164c9cf3fba5367d54b2a8146fda6052b7ee))
* **lot2-2.8b:** copy up to 1 000 operations into a v3 and close the second Codex review ([3b4f5ba](https://github.com/maxlemeur/HEX_BC/commit/3b4f5ba650fbb523ac91acf5b73c239eddb1e5a1))
* **lot2-2.8b:** fit a copy into a v3 in the CI timeout and keep its provenance and report ([f8650b8](https://github.com/maxlemeur/HEX_BC/commit/f8650b8a69e1a00ebdfbddf0f3c2f6be6eee0008))
* **lot2-2.8b:** read the linked DPGF by pages when it creates a v3 ([d548eea](https://github.com/maxlemeur/HEX_BC/commit/d548eea669e58932ba8aa4a5d4591322a46fb56f))
* **lot2-2.8b:** size a copy into a v3 as the database measures its operations ([cc92f1e](https://github.com/maxlemeur/HEX_BC/commit/cc92f1e57a607ce6813f26095c6cf02400b29f20))
* **lot2-2.8:** footer rule follows the OPTIMA subtotal structure ([d5b2490](https://github.com/maxlemeur/HEX_BC/commit/d5b2490f9816b29649c6e9906da2a3838de80386))
* **lot2-2.8:** keep the lines after an intermediate subtotal; generated ouvrages into a v3 ([4c9cf4a](https://github.com/maxlemeur/HEX_BC/commit/4c9cf4a0013797435de084f1e640546ab45f5cc3))
* **lot2-2.9:** let a converted offer serve both of its units ([3ae7e57](https://github.com/maxlemeur/HEX_BC/commit/3ae7e57e8699a8411b8e0683bcdc80cc191f72cb))
* **lot2-2.9:** order what the review shows and bound converted prices ([dcbcf91](https://github.com/maxlemeur/HEX_BC/commit/dcbcf912d9f4601dff2ee18c80d71b7215cf5020))
* **lot2-2.9:** read the unit of a v3 line in unit_code for purchases ([b6e60e8](https://github.com/maxlemeur/HEX_BC/commit/b6e60e8ec0252dabcd6004a8292b7632417c9766))
* **supabase:** prevent silent truncation of complete reads ([33c7031](https://github.com/maxlemeur/HEX_BC/commit/33c7031be14a605ed0129ac1aa8f0dc6c7a22a27))
* **supabase:** refuse restamps that miss applied records or base files ([88a64a8](https://github.com/maxlemeur/HEX_BC/commit/88a64a8abe0ccc02868e2c583495d29b367f829f))
* **supabase:** say when a restamp stopped after it started writing ([ab4ca9c](https://github.com/maxlemeur/HEX_BC/commit/ab4ca9c0772bea5d8acea57e88b9c68d444384a9))
* **test:** address review of the native-stack guard ([fbe1858](https://github.com/maxlemeur/HEX_BC/commit/fbe18588fefd3d97dc37a16841fc63c188a0ab09))
* **test:** end a cancelled build wait by its signal and match only Next build executables ([aadf741](https://github.com/maxlemeur/HEX_BC/commit/aadf741a68fcb0b0239a2831c2c3ac8381ed4226))
* **test:** keep the signal status of a cancelled wait and count orphan Next builds ([0c415fa](https://github.com/maxlemeur/HEX_BC/commit/0c415fa4e239a00393907d1e9a70883947598473))
* **test:** stop Army dev runs between phases and give local builds a place ([e1953fb](https://github.com/maxlemeur/HEX_BC/commit/e1953fbb970863796ba4772ddf9200e98b7d06f5))


### Performance Improvements

* **lot2-2.8:** replay per-line creation effects in one pass (M8) ([6c11eb6](https://github.com/maxlemeur/HEX_BC/commit/6c11eb668b30c4393afb6f206754ff6ccd5b4dba))

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
