# Hybridní projekt

Výuková prohlížečová hra o **hybridním řízení projektů**. Hráč vede projekt, jehož část se řídí
prediktivně (vodopád) a část agilně (Scrum), a učí se obě části propojit.

## Scénáře

| Scénář | Prediktivní část | Agilní část |
|---|---|---|
| 🏛️ Projekt Knihovna | rekonstrukce budovy, kiosky, kabeláž | mobilní aplikace, katalog |
| 🎸 Festival Soutok | povolení, pódia, smlouvy s kapelami | aplikace, vstupenky, kampaň |
| 🏭 Linka na elektrokola | hala, stroje, CE certifikace | software pro řízení výroby |

Každá hra vylosuje 3 události daného scénáře a 3 obecné (celkem 37 událostí) a odpovědi
se pokaždé zamíchají. Nejlepší skóre každého scénáře se ukládá v prohlížeči.

## Jak hrát

Spusť lokální server a otevři http://localhost:8765:

```bash
python3 -m http.server 8765
```

## Průběh hry

1. **Rozděl práci** – 8 oblastí projektu přiřadíš k prediktivnímu nebo agilnímu přístupu.
2. **Mix praktik** – ze 16 karet (prediktivní, propojovací, agilní) složíš vlastní model řízení
   s rozpočtem režie 8 bodů. Karty mají synergie a konflikty, některé sedí na kontext projektu
   a tři jsou pasti, které vypadají lákavě.
3. **Realizace** – 6 sprintů: plánování backlogu do kapacity týmu (MoSCoW, závislosti), událost
   v každém sprintu, prediktivní milníky a stage gate. Praktiky působí každý sprint, mění kapacitu,
   zmírňují dopady událostí a některé volby v událostech odemykají.
4. **Vzorce a antivzorce** – během hry se odhalují vzorce (7) a antivzorce (10), které tvůj mix
   v daném kontextu vytvořil. Každý je zapsaný jako řetězec
   **kontext → forma → mechanismus → důsledek**. Mechanismus působí od začátku, odhalí se až jeho důsledek.
5. **Vyhodnocení** – skóre (zdraví projektu, dodaná hodnota, manažerský úsudek), vzorce z této hry
   a **Atlas vzorců**, který se plní napříč hrami (ukládá se v prohlížeči).

## Struktura

- `index.html` – vstupní stránka
- `css/style.css` – vzhled (světlý i tmavý režim, mobil)
- `js/data.js` – veškerý obsah hry: `SCENARIOS` (scénáře s kontextem a vlastními událostmi),
  `PRACTICES`, `PRACTICE_PAIRS`, `ESSENTIALS`, `PATTERNS`, `CONTEXT_TAGS`, `GENERIC_EVENTS`,
  `GATE_EVENT`, `GLOSSARY`
- `js/game.js` – herní logika a vykreslování

### Jak přidat obsah

- **Novou událost do scénáře** přidej do `events` daného scénáře v `SCENARIOS`.
- **Obecnou událost** přidej do `GENERIC_EVENTS`. V textu můžeš použít zástupné symboly, které se
  nahradí výrazy ze scénáře: `{launch}`, `{predShort}`, `{agileShort}`, `{users}`, `{usersGen}`,
  `{sponsor}`, `{poGood}`, `{committee}`.
- **Nový scénář** zkopíruj podle existujícího: potřebuje `terms`, `context` (štítky z `CONTEXT_TAGS`), 8 `workstreams`, backlog
  (jednu položku s `needsMilestone: true`), 3 `milestones` (`dependency`, `schedule`, `launch`)
  a aspoň 3 vlastní `events`.

Každá volba má `rating` (`best` / `ok` / `bad`), `effects` na ukazatele a volitelně
`capacityMod` (změna kapacity příštího sprintu), `dropScope` (vyřazení položek MoSCoW kategorie)
nebo `needs` (id praktiky, bez které je volba zamčená).

- **Novou praktiku** přidej do `PRACTICES`: `cost` (režie), `effects` (jednorázově), volitelně
  `perSprint`, `capacity`, `softens`, `fits` (štítky z `CONTEXT_TAGS`) a `trap: true` pro pasti.
  Synergie a konflikty s jinými kartami zapiš do `PRACTICE_PAIRS`.
- **Nový vzorec / antivzorec** přidej do `PATTERNS`: podmínka `when(c)` (např.
  `c => c.has('scrum') && !c.has('po')`), okamžik odhalení `reveal` (číslo sprintu, `'m1'`,
  `'gate'` nebo `'soften'`), účinky `perSprint` / `once`, krátký příběh `story` a texty `k`, `f`, `m`, `d`.
