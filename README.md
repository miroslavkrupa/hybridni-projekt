# ⚗️ Projektová alchymie

*Namíchej správné řízení pro každý projekt.*

![Projektový manažer jako alchymista vaří v kotli projektovou metodiku](img/alchymie.svg)

Výuková prohlížečová hra o **řízení projektů**. Hráč vede projekt a musí nejdřív poznat, jaký přístup
mu sedí – **prediktivní** (vodopád), **agilní**, nebo **hybridní** – a pak k němu namíchat správné
praktiky. Univerzální recept neexistuje.

▶ **[Hrát online](https://miroslavkrupa.github.io/hybridni-projekt/)**

## Co je hybridní řízení projektů

Hra vychází z definice:

> *Hybrid project management is a project management approach combining elements of traditional
> and agile project management to gain advantages and suppress the disadvantages of both to increase
> project success. It balances flexibility, effectiveness, productivity, and project control. The
> ability to customize the combination to the specific needs makes this approach suitable for project
> management in various contexts.*
>
> — Krupa, M., Šimůnek, D. & Hájek, J. (2023). *Hybrid Project Management: A Literature Review.* HED 2023.

Hybridní řízení přitom není přizpůsobení (tailoring) agilního nebo tradičního přístupu, kombinace
praktik v rámci jednoho z nich, ani dočasná kombinace během přechodu od jednoho přístupu k druhému.
Proto hra obsahuje i čistě prediktivní a čistě agilní projekty.

## Scénáře

| Scénář | Typ | Čím je zajímavý |
|---|---|---|
| 🏛️ Projekt Knihovna | hybridní | rekonstrukce budovy a kiosky + mobilní aplikace a katalog |
| 🎸 Festival Soutok | hybridní | povolení, pódia, smlouvy s kapelami + aplikace, vstupenky, kampaň |
| 🏭 Linka na elektrokola | hybridní | hala, stroje, CE certifikace + software pro řízení výroby |
| ⚡ Odstávka elektrárny | prediktivní | **plánování po vlnách a Gantt** se závislostmi, kapacitou a rezervou |
| 🚀 Startup Zachraň jídlo | agilní | nejistý trh, **objevování hodnoty a experimenty** |

**🔥 Úroveň Hard** (odemkne se po dosažení 70 bodů v kterémkoli projektu Normal; pro učitele
a testování lze odemknout adresou s parametrem `?hard`, např. `…/hybridni-projekt/?hard`):

| Scénář | Typ | Co je na něm těžké |
|---|---|---|
| 🛰️ Studentská družice | hybridní | absolutní startovní okno (nestihnutí = konec projektu), tři integrační body, start se posune dřív |
| 🏥 Urgentní příjem nemocnice | hybridní | stavba za provozu; software se uprostřed stane zdravotnickým prostředkem |
| 🎮 Videohra v early accessu | agilní | peníze ubývají každý sprint, extrémně nejisté hodnoty, trh se otočí |
| 🌉 Výměna železničního mostu | prediktivní | pevné výluky (nedodělky se přesouvají), tři profese, inspekční dny, optimistické odhady |

Společné mechaniky Hardu:
- **méně zdrojů** – rozpočet režie 6 bodů, ukazatele startují na 40, projekt končí už při 10;
- **skrytý faktor kontextu** – jeden štítek kontextu je skrytý a odhalí se uprostřed projektu;
- **změna kontextu** – po kontrolním bodu se změní podmínky a hráč může **přeskládat mix**
  (přidat nejvýš 2 praktiky za cenu, odebrat cokoli). Kdo se nepřizpůsobí, toho každé období
  poškozuje antivzorec *Strnulá metodika*;
- **opožděné následky** – některá rozhodnutí se o 1–2 období později vrátí jako navazující
  událost (*Zametené pod koberec* / *Investice, která se vrací*); co se do projektu nevejde,
  dopadne jako *dozvuky po projektu*;
- **dilemata** – události, kde i nejlepší volba něco stojí.

Typ projektu hráč předem nevidí – určí ho v první fázi a hra ho odhalí až po vyhodnocení.
Každá hra vylosuje události scénáře a obecné události pro daný typ projektu (celkem 52 událostí)
a odpovědi se pokaždé zamíchají. Nejlepší skóre každého scénáře se ukládá v prohlížeči.

## Jak hrát

Online na https://miroslavkrupa.github.io/hybridni-projekt/ (GitHub Pages, aktualizuje se
po každém `git push` do větve `main`).

Lokálně spusť server a otevři http://localhost:8765:

```bash
python3 -m http.server 8765
```

## Průběh hry

1. **Rozděl práci** – 8 oblastí projektu přiřadíš k prediktivnímu nebo agilnímu přístupu.
   Pak se odhalí, jestli je projekt prediktivní, agilní, nebo hybridní.
2. **Mix praktik** – z 19 karet (prediktivní, propojovací a společné, agilní) složíš vlastní model
   řízení s rozpočtem režie 8 bodů. Karty mají synergie a konflikty, některé sedí na kontext projektu.
   Co je dobrá praktika, záleží na typu projektu: detailní Gantt je v prediktivním projektu správně,
   v hybridním je to past; Scrum v odstávce elektrárny je zbytečná režie.
3. **Realizace** – 6 období (sprintů nebo etap): plánování práce do kapacity týmu, událost
   v každém období, milníky a kontrolní bod v polovině projektu. Podle typu projektu:
   - **hybridní** – backlog s MoSCoW, závislost agilní části na prediktivním milníku;
   - **prediktivní** – etapy různé délky plánované **po vlnách**: budoucí etapy jen nahrubo
     (délka, odhad v člověkodnech, milník), nejbližší etapa podrobně v **Ganttu**. Hráč klikáním
     rozvrhne úkoly, vyznačí závislosti a hlídá kapacitu týmu (lidé na den). Po startu se etapa
     přehraje den po dni podle skutečných závislostí a velikosti týmu: zapomenutá závislost =
     přerušení a den práce navíc, přetížený plán = úkoly čekají na volné lidi. Co se nevejde do
     etapy, ukrojí z rezervy projektu. Nástroj „seřadit podle závislostí“ má jen hráč s praktikou
     pro harmonogram, kritickou cestu a vůli jen hráč s analýzou kritické cesty;
   - **agilní** – hodnota položek je jen odhad, skutečnost se ukáže po dodání (nebo experimentem
     s praktikou Hypotézy a experimenty); dodané funkce odhalují nové podněty; úspěch se měří trakcí.
4. **Vzorce a antivzorce** – během hry se odhalují vzorce (12) a antivzorce (16), které tvůj mix
   v daném kontextu vytvořil. Každý je zapsaný jako řetězec
   **kontext → forma → mechanismus → důsledek**. Mechanismus působí od začátku, odhalí se až jeho důsledek.
5. **Vyhodnocení** – skóre (zdraví projektu, dodaná hodnota, manažerský úsudek), vzorce z této hry
   a **Atlas vzorců**, který se plní napříč hrami (ukládá se v prohlížeči).

## Struktura

- `index.html` – vstupní stránka
- `img/` – úvodní ilustrace a ikona hry (SVG, světlý i tmavý režim)
- `css/style.css` – vzhled (světlý i tmavý režim, mobil)
- `js/data.js` – veškerý obsah hry: `SCENARIOS`, `PRACTICES`, `PRACTICE_PAIRS`, `ESSENTIALS`,
  `APPROACHES`, `PATTERNS`, `CONTEXT_TAGS`, `GENERIC_EVENTS`, `GATE_EVENT`, `GLOSSARY`
- `js/game.js` – herní logika a vykreslování

### Jak přidat obsah

- **Novou událost do scénáře** přidej do `events` daného scénáře v `SCENARIOS`.
- **Obecnou událost** přidej do `GENERIC_EVENTS` a v `approaches` uveď typy projektů, kde může nastat.
  V textu můžeš použít zástupné symboly, které se nahradí výrazy ze scénáře: `{launch}`,
  `{predShort}`, `{agileShort}`, `{users}`, `{usersGen}`, `{sponsor}`, `{poGood}`, `{committee}`.
- **Nový scénář** zkopíruj podle existujícího stejného typu. Každý potřebuje `approach`
  (`hybrid` / `pred` / `agile`), `terms`, `context` (štítky z `CONTEXT_TAGS`), neutrální `scope`
  (neprozrazuje typ), 8 `workstreams`, `backlog`, 3 `milestones` a aspoň 3 vlastní `events`.
  - hybridní: `predWorld`, `agileWorld`, jedna položka s `needsMilestone: true`, milníky
    `dependency`, `schedule`, `launch`;
  - prediktivní: `approachText`, `buffer` (rezerva ve dnech), `gateAfter`, vlastní `gate`
    a `phases` – etapy s `days` (délka), `crew` (lidé na den), `milestone` a `tasks`
    (`days`, `people`, skutečné `deps` a nápověda `note`; hráč závislosti odvozuje z popisu);
  - agilní: `approachText`, `targetValue`, položky s `value` (odhad) a `actual` (skutečnost),
    `reveals` + `discoveries` pro nové podněty, milníky `traction` s `target`, vlastní `gate`;
  - volitelně `baseCapacity` (kapacita týmu za období).
  - Hard: `level: 'hard'`, `hiddenContext`, `gateAfter`, `shift` (změna kontextu: `text`, `needs` –
    praktiky, které adaptaci splní, `penalty`, volitelně `devalue`, `addItems`, `capacityLoss`,
    `delayIfNot`) a `followups` (navazující události, na které odkazuje volba
    `later: { after, event }`, s `unresolved` pro dozvuky po projektu). Agilní Hard umí `burn`
    a `revenueDiv` (odpočet peněz a tržby), `experimentsPerSprint`. Prediktivní Hard umí etapy
    jako výluky (`window: true`), více profesí (`crew: { obecne, svarec, jerab }`, `skill` u úkolu),
    inspekční dny (`holdDay`) a hrubé odhady (`rough`). Hybridní Hard umí milníky `integration`
    (`requires`) a fatální start (`launch` s `fatal: true`).

Každá volba má `rating` (`best` / `ok` / `bad`), `effects` na ukazatele a volitelně
`capacityMod` (změna kapacity příštího období), `dropScope` (vyřazení položek MoSCoW kategorie),
`needs` (id praktiky, bez které je volba zamčená), `addItems` (nová práce), `verify`
(ověří hodnotu položek) nebo `delay` (dny zpoždění etapy v prediktivním projektu).

- **Novou praktiku** přidej do `PRACTICES`: `cost` (režie), `effects` (jednorázově), `useIn`
  (typy projektů, kde má smysl), `trapIn` (kde je pastí), volitelně `perSprint`, `capacity`,
  `softens`, `bufferBonus`, `planning`, `fits` (štítky z `CONTEXT_TAGS`).
  Synergie a konflikty s jinými kartami zapiš do `PRACTICE_PAIRS`, základy dobrého mixu
  pro každý typ projektu do `ESSENTIALS`.
- **Nový vzorec / antivzorec** přidej do `PATTERNS`: `approaches`, podmínka `when(c)` (např.
  `c => c.has('scrum') && !c.has('po')`), okamžik odhalení `reveal` (číslo období, `'m1'`,
  `'gate'` nebo `'soften'`), účinky `perSprint` / `once`, krátký příběh `story` a texty `k`, `f`, `m`, `d`.
