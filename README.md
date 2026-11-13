# LAYOVER v0.3 ✳ — Circles, shared calendar, corkboard

**Verze pro existující LAYOVER v0.2 a stejný Supabase projekt.** Každá skupina má nyní 3 mobilní záložky: **Chat · Calendar · Corkboard**.

## Pozor: pořadí nasazení je důležité

1. **Nejdřív databáze:** v existujícím projektu Supabase otevři **SQL Editor → New query**, zkopíruj celý `supabase/upgrade_v0.3.sql` a klikni **Run**. Očekávané: `Success. No rows returned` (případně oznámení pro již existující policy/trigger). Soubor je idempotentní a **neodstraňuje existující uživatele, chaty ani skupiny**.
2. **Potom GitHub:** do repozitáře nahraj nové `index.html`, `app.js`, `styles.css`, `sw.js`, `config.js`, `manifest.webmanifest`, `assets/`, `supabase/` a `README.md`. Nezapomeň, že `index.html` patří přímo do kořene. Jestli přecházíš z v0.2, staré soubory můžeš nahradit stejnojmennými. `.github/` a `CNAME` zachovej, pokud je používáš.
3. **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` → `/(root)`. Po aktualizaci stránky případně použij obnovení bez cache nebo zavři a znovu otevři PWA.
4. **Supabase Auth:** Authentication → URL Configuration → Site URL + Redirect URLs nastav na svou aktuální GitHub Pages adresu. Platí i pro potvrzovací e-maily.

**Připojení je už v `config.js` předvyplněné** veřejnou URL a `sb_publishable_...` klíčem, které byly zadány pro tento projekt. **Žádný tajný klíč v balíčku není.** `sb_secret_...` klíč, který byl dříve zveřejněn v konverzaci, zneplatni v Supabase → API Keys; není potřeba pro web.

> **Neaplikuj znovu** `supabase/schema.sql` na svou stávající databázi. To je původní instalátor určený jen pro čistý v0.2 projekt; upgrade je výhradně `upgrade_v0.3.sql`.

## Nové funkce a pravidla

### Skupiny, role a pozvánky

- `create_circle` je serverová Supabase RPC. Nová skupina dostane zakladatele jako `owner` **atomicky**. Vlastník má práva admina, ale nikdo si vlastníka nemůže sám přidělit.
- `owner` může pozvat nové účty, povýšit ostatní na `admin`, vrátit je na `member`, odstranit člena i zrušit nevyřízenou pozvánku.
- `admin` může **zvát další lidi**, rušit čekající pozvánky a odstranit běžné členy. Nemůže povyšovat/demotovat adminy ani odstranit zakladatele.
- `member` může psát zprávy, přidávat cesty i fotky, ale nemůže zvát další uživatele (pro pozvánky ho vlastník může povýšit na admina).
- Pozvaný účet musí **sám přijmout** pozvánku pod záložkou Invitations. Do té doby zprávy nevidí.

### Kalendář uvnitř každé skupiny

- Všichni členové vidí společný měsíční kalendář a mohou přidávat svoje plány.
- **Trip:** město, země, od–do, krátká poznámka. Termín může být vícedenní.
- **Wish list:** město, země, přibližný měsíc a rok, poznámka (bez přesného dne).
- Výběr města/země má chytré textové návrhy pro oblíbené destinace a umožňuje zadat libovolné město/zem.
- Autor může svůj plán upravit nebo smazat. Admin může smazat nevhodné záznamy. Ostatní členové ho jen vidí.
- Žádné GPS, živé sledování polohy ani veřejné cestovní plány napříč skupinami.

### Korková nástěnka / polaroidy

- Každý kruh má vlastní korkovou nástěnku, fotky jsou zobrazené v bílém polaroidovém rámečku s připínáčkem a ručně psaným popiskem (max. 80 znaků).
- Jen JPG / PNG / WebP; z mobilu jsou soubory převáděny na komprimovaný JPEG. Videonahrávky nejsou podporované.
- **Max. 100 fotek na skupinu**, limit vynucuje databázový trigger i uživatelské rozhraní.
- Fotky jsou v privátním bucketu `circle-photos`. Náhledy vznikají z časově omezených signed URL, ne z veřejných odkazů.
- Autor a admin mohou fotku odstranit. Fotky ostatních uživatelů nikdy nenahrávej bez jejich souhlasu.

## Co dnes reálně otestovat na dvou telefonech

1. **A:** Přihlaš se a dej `Create circle → Sir Tobeys Locos`. Musí vzniknout jedna skupina a zakladatel musí být `OWNER`.
2. **B:** Přihlaš se do jiného účtu, nastav si na profilu vlastní username a fotografii.
3. **A:** `Invite → @username` druhého účtu → `Send invitation`. V seznamu čekajících pozvánek se objeví jeho username.
4. **B:** `Invitations → Join circle` a otevře se mu skupina. Ověř, že před přijetím neviděl obsah chatu, kalendáře ani nástěnky.
5. **A:** V seznamu lidí změň roli B na `Admin`. **B** teď musí vidět tlačítko Invite a moci pozvat účet **C**. B nesmí mít možnost povýšit dalšího admina ani smazat vlastníka.
6. **A i B:** Pošlete zprávy; ověřte jejich zobrazení i v druhém okně.
7. **B:** Přidej do Calendar cestu např. `Berlin, Germany` na dvě data, a wishlist např. `Lisbon, Portugal` v příštím roce; **A** má oba záznamy vidět po aktualizaci.
8. **B:** Přidej fotku s popiskem `Prague Castle ’26`; **A** uvidí polaroid na Corkboard. Ověř soukromí s nepřizvaným účtem **C** před přijetím pozvánky.
9. **A:** Odstraň testovací fotku a plán, případně otestuj revokaci pozvánky před přijetím.

**Stav testování balíčku:** syntaxe JavaScriptu a mobilní prohlížečový smoke test s **mockovaným** Supabase klientem prošly. Reálné průchody dvou účtů a RLS v tvém projektu **nemohu potvrdit bez přístupu k němu**. `tests/check_static.cjs` a `tests/ui_smoke.py` jsou automatizované testy, `supabase/check_v0.3.sql` je jen read-only diagnostika.

## Známá omezení před veřejným spuštěním

- Vhodné jako soukromý pilot s malou známou skupinou, **ne** jako otevřená sociální síť bez moderace. Chybí blokování uživatelů, moderátorský dashboard, self-service odstranění účtu a data export.
- Skupiny jsou invite-only. Profilové username jsou dostupné registrovaným uživatelům pro vyhledávání přesné shody.
- Pokud se v kalendáři nebo na nástěnce projeví změny druhých lidí se zpožděním, použij `Refresh` v záhlaví skupiny. Realtime Postgres Changes je vhodný pro malý pilot, ne pro velký provoz.
- Historické fotky se při smazání skupiny klientsky pokouší odstranit z bucketu před smazáním databáze; pro produkci je potřeba spolehlivý serverový úklid souborů.
- Kapacita Supabase Storage a limity odesílání potvrzovacích e-mailů se řídí podmínkami tvého projektu.
- Aplikace vyžaduje připojení k internetu pro účty, zprávy, fotky a plány.

## Struktura

```text
index.html
app.js
styles.css
config.js
sw.js
manifest.webmanifest
assets/
supabase/schema.sql            # POUZE původní instalace na čistý DB
supabase/upgrade_v0.3.sql      # SPUSŤ teď nad existující v0.2
supabase/check_v0.3.sql        # Volitelná read-only diagnostika
tests/check_static.cjs
tests/ui_smoke.py
README.md
```

### Technické odkazy

- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [GitHub Pages deployment](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
