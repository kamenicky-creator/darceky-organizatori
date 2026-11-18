# Darčeky pre organizátorov

Tímový prehľad darčekov pre organizátorov. Každý KAM si po prihlásení vyberie, kto je, uvidí svoje portfólio klientov z retieringu a ku klientovi zapíše darček.

- Brána „Kto si?“ ako v HO kalendári: po prihlásení si vyberieš meno a zobrazí sa tvoje portfólio
- Klienti a tiery sa čítajú priamo z Google tabuľky „PLG CZ – retiering – source“ (hárok Source, stĺpce Final tier a Responsible new)
- Ak organizátor v retieringu nie je, dá sa pridať ako nový (názov, IČO, tier)
- Polia darčeka: KAM / kontakt u nás, Dôvod, Počet, Stav, Termín, Poznámka
- Dôvody: Business improvement, Business stable, Business fix (pri Business fix je poznámka povinná)
- Stavy: Navrhnuté → Schválené → Objednané → Odovzdané, darčeky po termíne sú zvýraznené
- Pri každom darčeku je uložené, kto ho zapísal a kedy, a kto ho naposledy upravil
- Člen tímu upraví a odstráni len darčeky, ktoré sám zapísal, správca všetky
- Funguje na počítači aj v mobile, vo svetlom aj tmavom režime

Rovnako ako HO kalendár a prehľad techniky beží na Verceli za spoločným tímovým heslom. Kolegovia nepotrebujú žiadny účet, stačí im adresa a heslo. Dáta sú v Google tabuľke, ku ktorej je pripojený malý server v Google Apps Scripte. Prehliadač komunikuje len s Vercelom: adresa Apps Scriptu a tímový kľúč zostávajú na serveri.

## Obsah repozitára

| Súbor | Na čo slúži |
| --- | --- |
| `index.html`, `assets/` | Samotný prehľad |
| `login.html` | Prihlasovacia stránka |
| `middleware.js` | Brána: bez prihlásenia Vercel nevydá žiadnu stránku ani dáta |
| `api/` | Prihlásenie, výber mena, zoznam tímu, odhlásenie a sprostredkovanie dát (Vercel Functions) |
| `config.js` | Názov tímu a frekvencia obnovy |
| `apps-script/Code.gs` | Server, vkladá sa do Google Apps Scriptu |
| `apps-script/appsscript.json` | Nastavenie projektu, treba len pri nasadzovaní cez `clasp` |

## Nastavenie

### 1. Google tabuľka a Apps Script

1. Tabuľka s dátami už existuje: [Darčeky pre organizátorov – dáta](https://docs.google.com/spreadsheets/d/1iHvdCp_OD55wpYS-ikFBnPlQEDe_dD3-AidkOBLg398/edit). Má hárky „Darčeky“, „Noví organizátori“ a „Tím“ (tím je predvyplnený aj s e-mailmi). Jej ID je v `SPREADSHEET_ID` na začiatku `Code.gs`. Pre novú tabuľku stačí ID zmeniť, chýbajúce hárky vzniknú samé.
2. V tabuľke otvor **Rozšírenia › Apps Script**, obsah `Kód.gs` nahraď obsahom `apps-script/Code.gs` a ulož.
3. Hore vyber funkciu `skontrolujNastavenie`, klikni na **Spustiť** a povoľ prístup. Skript overí hárky a to, že sa dostane k retieringu. V protokole uvidíš, koľko klientov načítal (malo by ich byť okolo 3 278).
   Skript beží pod tvojím účtom, preto musíš mať prístup na čítanie do tabuľky „PLG CZ – retiering – source“.
4. Tímový kľúč: vyber funkciu `vytvorTimovyKluc` a klikni na **Spustiť**. Kľúč nájdeš v protokole spustenia.
5. Klikni na **Nasadiť › Nové nasadenie**, typ **Webová aplikácia**:
   - Spustiť ako: **Ja**
   - Kto má prístup: **Ktokoľvek**
6. Skopíruj URL webovej aplikácie (končí na `/exec`).

Prístup „Ktokoľvek“ je potrebný, aby sa na server dostal Vercel. Bez tímového kľúča server nič neprečíta ani nezapíše.

### 2. Vercel

1. Importuj repozitár (Application Preset: **Other**, bez build príkazu).
2. V **Settings › Environment Variables** pridaj:

   | Premenná | Hodnota |
   | --- | --- |
   | `APP_PASSWORD` | tímové heslo na prihlásenie |
   | `ADMIN_PASSWORD` | heslo správcu: môže upraviť a odstrániť všetky darčeky a načítať retiering nanovo |
   | `GAS_URL` | URL webovej aplikácie z Apps Scriptu (končí na `/exec`) |
   | `GAS_KEY` | tímový kľúč z Apps Scriptu |
   | `SESSION_SECRET` | voliteľné: ľubovoľný náhodný text na podpis prihlásenia |

3. V **Deployments** pri poslednom nasadení klikni na **… › Redeploy**, aby sa premenné načítali.

### 3. Tím

Pošli kolegom adresu prehľadu a tímové heslo. Po prihlásení si každý vyberie svoje meno („Kto si?“) a hneď uvidí svoje portfólio. Prehliadač si prihlásenie aj vybrané meno zapamätá na 30 dní, meno sa dá zmeniť odkazom „Zmeniť“ vpravo hore.

Správca sa prihlási na tej istej stránke heslom z `ADMIN_PASSWORD`. Vyberie si svoje meno alebo „Správca, nie som v zozname“. Vpravo hore uvidí štítok „Správca“ a môže upraviť a odstrániť všetky darčeky.

## Dáta v Google tabuľke

Hárok **Tím** má stĺpce `id`, `meno`, `aktivny`, `email`. Do stĺpca `email` patrí adresa, pod ktorou je KAM v retieringu v stĺpci „Responsible new“ (viac adries oddeľ čiarkou). Podľa nej sa skladá portfólio. Nového kolegu pridáš novým riadkom, odchádzajúcemu nastav `aktivny` na FALSE: zmizne z výberu, jeho záznamy zostanú. Klienti s adresou `service@…` alebo s adresou, ktorá v hárku Tím nie je, sú v prehľade ako „Servisní klienti (bez KAM)“.

Hárok **Darčeky** má stĺpce `id`, `organizator`, `ico`, `tier`, `kam`, `dovod`, `pocet`, `stav`, `termin`, `poznamka`, `zapisal`, `zapisane`, `upravil`, `upravene`, `klient`, `vlastnik`. Hodnoty sú zapísané čitateľne (napríklad „PREMIUM“, „Business fix“, „Schválené“) a stĺpce s výberom majú rozbaľovací zoznam. Tier sa pri zápise skopíruje z retieringu, aby zostal taký, aký bol v čase darčeka.

Hárok **Noví organizátori** obsahuje organizátorov pridaných v prehľade, ktorí nie sú v retieringu.

Tabuľku môžeš upravovať aj ručne, prehľad zmeny načíta do minúty. Ručne pridaný riadok bez `id` dostane `id` automaticky a v prehľade ho môže meniť len správca. Stĺpce `id`, `klient` a `vlastnik` neupravuj.

Retiering sa len číta, nikdy sa doň nezapisuje. Server si načítaný zoznam klientov pamätá 15 minút. Správca ho vie načítať hneď tlačidlom „Načítať retiering nanovo“ pod portfóliom.

## Bežná údržba

- **Zmena hesla:** zmeň `APP_PASSWORD` alebo `ADMIN_PASSWORD` a daj Redeploy. Všetci sa musia prihlásiť znova.
- **Odhlásenie všetkých bez zmeny hesla:** zmeň `SESSION_SECRET` a daj Redeploy.
- **Zmena tímového kľúča:** spusti znova `vytvorTimovyKluc`, nový kľúč vlož do `GAS_KEY` a daj Redeploy.
- **Iný zdroj retieringu:** zmeň `RETIER_ID`, `RETIER_SHEET` alebo názvy stĺpcov v `RETIER_COLS` na začiatku `Code.gs`.
- **Úprava servera:** po zmene `Code.gs` otvor **Nasadiť › Spravovať nasadenia**, uprav existujúce nasadenie a zvoľ **Nová verzia**. URL zostane rovnaká.
- **Úprava stránky:** stačí zmena vo vetve `main`, Vercel ju nasadí sám.
- **Frekvencia obnovy:** `pollSeconds` v `config.js` (predvolene 60 sekúnd, minimum 20). Prehľad sa obnoví aj pri návrate na kartu.

## Skúšanie bez servera

Na úpravy vzhľadu nastav v `config.js` dočasne `apiUrl: ''` a otvor `index.html`. Prehľad potom ukladá zmeny len do tvojho prehliadača. Ukážkových klientov a tím doplníš do `config.js` ako `localClients` (`[{n, v, t, e, p, g}]`) a `localTeam` (`['Meno', …]`).
