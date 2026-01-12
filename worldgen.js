/*
 * World generation functions for Traveller/Cepheus Deluxe worlds.
 *
 * This module exposes a function generateWorld() which returns an
 * object describing a randomly generated main world using the rules
 * laid out in the Cepheus Deluxe world generation chapter.  The
 * probability distributions are based on the classic 2D6 Traveller
 * tables with modifiers.  Where the exact table values were not
 * available, reasonable approximations have been used that preserve
 * the overall shape of the distributions.  For example, Tech Level
 * modifiers follow the standard Traveller/Cepheus conventions: high
 * quality starports give large bonuses, while poor or non‑existent
 * starports penalise the result.  Minimum Tech Levels for hostile
 * environments are enforced as per the rulebook.
 */

/**
 * Roll a pair of six‑sided dice and return the sum (range 2–12).
 * @returns {number}
 */
function roll2D() {
    return Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
}

/**
 * Clamp a numeric value to the supplied inclusive range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Generate a world Size rating (0–10) by rolling 2D6–2.  Asteroid belts
 * (size 0) and tiny worlds (size 1) are included.  Values are clamped
 * to the range specified in the Cepheus Deluxe table.
 * @returns {number}
 */
function generateSize() {
    const size = roll2D() - 2;
    return clamp(size, 0, 10);
}

/**
 * Generate an Atmosphere rating (0–15) using 2D6–7 + Size.  If Size is
 * zero the atmosphere is automatically zero.  Otherwise the value is
 * clamped to the rulebook bounds.  This function does not apply
 * further modifiers – any unusual atmospheres beyond the standard
 * table can be added by users as desired.
 * @param {number} size
 * @returns {number}
 */
function generateAtmosphere(size) {
    if (size === 0) return 0;
    let atm = roll2D() - 7 + size;
    return clamp(atm, 0, 15);
}

/**
 * Generate a Hydrographics rating (0–10) using 2D6–7 + Size with
 * modifiers based on Atmosphere.  Size 0–1 worlds always have
 * Hydrographics 0.  Worlds with unbreathable atmospheres (0,1,A,B,C)
 * suffer DM–4; worlds with atmosphere E suffer DM–2.  Result is
 * clamped to 0–10.
 * @param {number} size
 * @param {number} atmosphere
 * @returns {number}
 */
function generateHydrographics(size, atmosphere) {
    if (size === 0 || size === 1) return 0;
    let hydro = roll2D() - 7 + size;
    // Apply DMs from atmosphere
    // unbreathable atmospheres (Vacuum, Trace, Exotic, Corrosive, Insidious)
    const unbreathable = [0, 1, 10, 11, 12];
    if (unbreathable.includes(atmosphere)) {
        hydro -= 4;
    }
    // Unusual atmosphere E (14)
    if (atmosphere === 14) {
        hydro -= 2;
    }
    return clamp(hydro, 0, 10);
}

/**
 * Generate a Population rating (0–10) using 2D6–2 with modifiers.  The
 * DM table is adapted from Cepheus Deluxe: Standard atmospheres (6)
 * add +3; Standard Tainted (7) adds +1; Thin or Dense (5 or 8)
 * add +1; Unbreathable atmospheres (Vacuum, Trace, Exotic,
 * Corrosive, Insidious) subtract 2.  Worlds with Hydrographics 0 and
 * Very Thin or less atmosphere (≤3) have DM–1.  Population ratings
 * are orders of magnitude (0=none, 1=dozens, 2=hundreds, ...).
 * @param {number} atmosphere
 * @param {number} hydro
 * @returns {number}
 */
function generatePopulation(atmosphere, hydro) {
    let pop = roll2D() - 2;
    let dm = 0;
    // Unbreathable atmospheres penalise population
    const unbreathable = [0, 1, 10, 11, 12];
    if (unbreathable.includes(atmosphere)) dm -= 2;
    // Standard atmosphere adds +3
    if (atmosphere === 6) dm += 3;
    // Standard tainted adds +1
    if (atmosphere === 7) dm += 1;
    // Thin or Dense atmospheres add +1
    if (atmosphere === 5 || atmosphere === 8) dm += 1;
    // Hydrographics 0 with very thin or less atmosphere subtracts 1
    if (hydro === 0 && atmosphere <= 3) dm -= 1;
    pop += dm;
    return clamp(pop, 0, 10);
}

/**
 * Generate a Government rating (0–15) using 2D6–7 + Population.  Worlds
 * with Population 0 automatically have Government 0.  Result is
 * clamped to 0–15.
 * @param {number} population
 * @returns {number}
 */
function generateGovernment(population) {
    if (population === 0) return 0;
    let gov = roll2D() - 7 + population;
    return clamp(gov, 0, 15);
}

/**
 * Generate a Law Level rating (0–10) using 2D6–7 + Government.  Worlds
 * without Government (gov=0) have Law Level 0.  Law Level is clamped
 * between 0 and 10.
 * @param {number} government
 * @returns {number}
 */
function generateLaw(government) {
    if (government === 0) return 0;
    let law = roll2D() - 7 + government;
    return clamp(law, 0, 10);
}

/**
 * Generate a Starport class (A, B, C, D, E or X) based on 2D6–7 +
 * Population.  Worlds without population default to class X.  The
 * resulting numeric value maps to starport classes as follows:
 * ≤2: X; 3–4: E; 5–6: D; 7–8: C; 9–10: B; ≥11: A.
 * @param {number} population
 * @returns {string}
 */
function generateStarport(population) {
    if (population === 0) return 'X';
    const val = roll2D() - 7 + population;
    if (val <= 2) return 'X';
    if (val <= 4) return 'E';
    if (val <= 6) return 'D';
    if (val <= 8) return 'C';
    if (val <= 10) return 'B';
    return 'A';
}

/**
 * Generate a Tech Level value (0–∞) starting with 1D6 and applying
 * modifiers based on Starport, Size, Atmosphere, Hydrographics,
 * Population and Government.  This approximation follows the
 * Traveller/Cepheus tables: high‑quality ports grant a bonus, poor
 * ports penalise, very small or very large worlds modify, hostile
 * atmospheres nudge the result, etc.  Minimum Tech Levels required
 * for hostile environments are enforced (e.g. vacuum worlds with
 * large populations have at least TL4, tainted/hostile atmospheres
 * require TL5 or 7).
 * @param {number} size
 * @param {number} atmosphere
 * @param {number} hydro
 * @param {number} population
 * @param {number} government
 * @param {string} starport
 * @returns {number}
 */
function generateTechLevel(size, atmosphere, hydro, population, government, starport) {
    let tl = Math.floor(Math.random() * 6) + 1; // roll 1D6
    let dm = 0;
    // Starport modifiers
    switch (starport) {
        case 'A': dm += 6; break;
        case 'B': dm += 4; break;
        case 'C': dm += 2; break;
        case 'X': dm -= 4; break;
        default: break;
    }
    // Size modifiers
    if (size === 0 || size === 1) dm += 2;
    else if (size >= 2 && size <= 3) dm += 1;
    else if (size >= 8 && size <= 9) dm += 1;
    else if (size === 10) dm += 2;
    // Atmosphere modifiers
    if (atmosphere <= 3 || [10, 11, 12].includes(atmosphere)) dm += 1;
    if (atmosphere === 4 || atmosphere === 7 || atmosphere === 9) ; // no DM for standard/tainted
    // Hydrographics modifiers
    if (hydro === 0 || hydro === 9) dm += 1;
    if (hydro === 10) dm += 2;
    // Population modifiers
    if (population === 1 || population === 2) dm += 1;
    if (population >= 3 && population <= 5) dm += 1;
    if (population === 9) dm += 2;
    if (population === 10) dm += 4;
    // Government modifiers
    if (government === 0 || government === 5) dm += 1;
    if (government === 13 || government === 14) dm += 1;
    if (government === 9) dm += 2;
    tl += dm;
    if (tl < 0) tl = 0;
    // Minimum TL requirements for survival on hostile worlds
    // Vacuum/No atmosphere or hydro 0 with large populations require TL4
    if ((hydro === 0 || hydro === 10) && population >= 6) tl = Math.max(tl, 4);
    // Tainted/dense atmospheres require TL5
    if ([4, 7, 9].includes(atmosphere)) tl = Math.max(tl, 5);
    // Very thin or worse atmospheres (≤3) or Exotic/Corrosive/Insidious/Unusual require TL7
    if (atmosphere <= 3 || [10, 11, 12, 15].includes(atmosphere)) tl = Math.max(tl, 7);
    return tl;
}

/**
 * Determine trade codes based on the world characteristics.  See
 * Cepheus Deluxe for definitions.  Codes include:
 *  Ag – Agricultural; As – Asteroid; Ba – Barren; De – Desert;
 *  Fl – Fluid Oceans; Ga – Garden; Hi – High Population;
 *  Ht – High Tech; Ic – Ice‑Capped; In – Industrial; Lo – Low
 *  Population; Lt – Low Tech; Na – Non‑Agricultural; Ni – Non‑Industrial;
 *  Po – Poor; Ri – Rich; Wa – Water world; Va – Vacuum.
 * @param {number} size
 * @param {number} atmosphere
 * @param {number} hydro
 * @param {number} pop
 * @param {number} tl
 * @returns {string[]}
 */
function generateTradeCodes(size, atmosphere, hydro, pop, tl) {
    const codes = [];
    // Agricultural: Thin/Std/Dense atmospheres (4–9, excluding 0–3 and 10+), hydro 5–7, pop 5–7
    if (size >= 4 && size <= 9 && [4, 5, 6, 7, 8, 9].includes(atmosphere) && hydro >= 5 && hydro <= 7 && pop >= 5 && pop <= 7) {
        codes.push('Ag');
    }
    // Asteroid: size 0
    if (size === 0) codes.push('As');
    // Barren: population 0
    if (pop === 0) codes.push('Ba');
    // Desert: atmosphere ≥2 and hydro 0
    if (atmosphere >= 2 && hydro === 0) codes.push('De');
    // Fluid Oceans: Exotic/Corrosive/Insidious atmospheres (10–12) and hydro ≥1
    if ([10, 11, 12].includes(atmosphere) && hydro >= 1) codes.push('Fl');
    // Garden: atmospheres 5,6,8; hydro 4–8; pop 4–8
    if ([5, 6, 8].includes(atmosphere) && hydro >= 4 && hydro <= 8 && pop >= 4 && pop <= 8) codes.push('Ga');
    // High Population: population ≥9
    if (pop >= 9) codes.push('Hi');
    // High Technology: TL ≥12
    if (tl >= 12) codes.push('Ht');
    // Ice‑Capped: atmosphere ≤1 and hydro ≥1
    if (atmosphere <= 1 && hydro >= 1) codes.push('Ic');
    // Industrial: atmospheres 0–2 or 4 or 7 or 9 and pop ≥9
    if ([0, 1, 2, 4, 7, 9].includes(atmosphere) && pop >= 9) codes.push('In');
    // Low Population: pop 1–3
    if (pop >= 1 && pop <= 3) codes.push('Lo');
    // Low Technology: TL ≤5
    if (tl <= 5) codes.push('Lt');
    // Non‑Agricultural: atmospheres ≤3, hydro ≤3, pop ≥6
    if (atmosphere <= 3 && hydro <= 3 && pop >= 6) codes.push('Na');
    // Non‑Industrial: pop 4–6
    if (pop >= 4 && pop <= 6) codes.push('Ni');
    // Poor: atmospheres 2–5 and hydro ≤3
    if (atmosphere >= 2 && atmosphere <= 5 && hydro <= 3) codes.push('Po');
    // Rich: atmospheres 6 or 8; pop 6–8
    if ((atmosphere === 6 || atmosphere === 8) && pop >= 6 && pop <= 8) codes.push('Ri');
    // Water world: hydro 10
    if (hydro === 10) codes.push('Wa');
    // Vacuum: atmosphere 0
    if (atmosphere === 0) codes.push('Va');
    return codes;
}

/**
 * Generate base codes present in the system based on Starport class.
 * Naval bases appear on A/B ports on 8+; research bases appear on
 * A/B/C ports on 10+ (DM–2 for A ports); scout bases appear on
 * D/C/B/A ports on 7+ (DMs for better ports); pirate bases appear
 * on worlds without naval bases or class A ports on 12+.
 * Returns an array of base codes: N, R, S and/or P.
 * @param {string} starport
 * @returns {string[]}
 */
function generateBases(starport) {
    const bases = [];
    // Naval base: starport A or B, roll 8+
    if (starport === 'A' || starport === 'B') {
        let r = roll2D();
        if (r >= 8) bases.push('N');
    }
    // Research base: starport A/B/C, roll 10+; DM–2 if A (more likely)
    if (['A', 'B', 'C'].includes(starport)) {
        let r = roll2D();
        let threshold = 10;
        if (starport === 'A') threshold -= 2; // DM–2 lowers threshold
        if (r >= threshold) bases.push('R');
    }
    // Scout base: starport D or better on 7+; DM–1 for C, –2 for B, –3 for A
    if (['A', 'B', 'C', 'D'].includes(starport)) {
        let r = roll2D();
        let threshold = 7;
        if (starport === 'C') threshold -= 1;
        else if (starport === 'B') threshold -= 2;
        else if (starport === 'A') threshold -= 3;
        if (r >= threshold) bases.push('S');
    }
    // Pirate base: only if no naval base and starport not A; roll 12+
    if (!bases.includes('N') && starport !== 'A') {
        let r = roll2D();
        if (r >= 12) bases.push('P');
    }
    return bases;
}

/**
 * Determine whether the system has a gas giant.  Cepheus Deluxe
 * suggests rolling 2D and noting a gas giant on a roll of 5 or greater
 *【435193721292873†L21-L30】.  This function returns true if the roll
 * meets or exceeds the threshold.  The probability of gas giants is high
 * (approximately 83%) but can be adjusted if needed.
 * @returns {boolean}
 */
function generateGasGiant() {
    // Roll two six‑sided dice and check if the total is 5 or more
    return roll2D() >= 5;
}

/**
 * Generate a complete world using the functions above.  Returns an
 * object containing all the relevant characteristics.
 * @returns {object}
 */
function generateWorld() {
    const size = generateSize();
    const atmosphere = generateAtmosphere(size);
    const hydro = generateHydrographics(size, atmosphere);
    const population = generatePopulation(atmosphere, hydro);
    const government = generateGovernment(population);
    const law = generateLaw(government);
    const starport = generateStarport(population);
    const tech = generateTechLevel(size, atmosphere, hydro, population, government, starport);
    const tradeCodes = generateTradeCodes(size, atmosphere, hydro, population, tech);
    const bases = generateBases(starport);
    const gasGiant = generateGasGiant();
    return {
        size,
        atmosphere,
        hydrographics: hydro,
        population,
        government,
        law,
        starport,
        techLevel: tech,
        tradeCodes,
        bases,
        gasGiant
    };
}

// Expose the generateWorld() function on the global object when
// running in a browser so that other scripts (e.g. script.js) can
// invoke it.  Node.js users can import this module using CommonJS.
if (typeof window !== 'undefined') {
    window.generateWorld = generateWorld;
}
// Support CommonJS (Node.js) exports without using ES module syntax in
// the browser.  When module.exports is available, assign generateWorld
// to it.  This avoids syntax errors when loading this script in a
// non‑module context in the browser.
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { generateWorld };
}