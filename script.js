/*
 * Star Density Heat Map Generator
 *
 * This script implements a simplified slime‑mold (Physarum) simulation to
 * generate a density field over an 8 × 10 grid.  Agents move in a discrete
 * pixel space, sense a trail ahead, turn towards higher values, deposit
 * trail and the trail diffuses and decays.  After the simulation, the
 * accumulated trail is mapped onto a hexagonal grid and quantized to
 * produce dark and light tiles.  Users can regenerate the map, adjust
 * quantization bit depth and export the canvas as a PNG.
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('heatmapCanvas');
    const ctx = canvas.getContext('2d');

    // Temporary global error handler for debugging.  Any uncaught
    // exceptions will be displayed on the page.  Remove or comment out in production.
    window.addEventListener('error', (e) => {
        const pre = document.createElement('pre');
        pre.style.color = 'red';
        pre.textContent = 'Error: ' + e.message;
        document.body.appendChild(pre);
    });
    const bitDepthSlider = document.getElementById('bitDepth');
    const bitDepthValue = document.getElementById('bitDepthValue');
    const generateBtn = document.getElementById('generate');
    const downloadBtn = document.getElementById('download');
    const downloadSubsectorBtn = document.getElementById('downloadSubsector');
    // Randomize seed button
    const randomizeBtn = document.getElementById('randomizeSeed');
    // Zoom controls
    const zoomSlider = document.getElementById('zoom');
    const zoomValue = document.getElementById('zoomValue');

    // Simulation scale controls
    const simScaleSlider = document.getElementById('simScale');
    const simScaleValue = document.getElementById('simScaleValue');
    // Saturate controls
    const saturateSlider = document.getElementById('saturate');
    const saturateValue = document.getElementById('saturateValue');
    // Display mode radio buttons
    const modeRadioButtons = document.querySelectorAll('input[name="displayMode"]');

    // Seed input and display elements
    const seedInput = document.getElementById('seedInput');
    const seedDisplay = document.getElementById('seedDisplay');

    // Printable mode checkbox
    const printableCheckbox = document.getElementById('printable');

    // Initialise state flags before any UI components are bound.  These
    // variables need to exist prior to event binding because the listeners
    // reference them.  Defining them here avoids reference errors
    // caused by temporal dead zones when using `let` declarations.
    let showBoundaries = true;
    let generateWholeWorlds = true;
    let worlds = [];

    // Presence threshold controls
    const presenceSlider = document.getElementById('presenceThreshold');
    const presenceValue = document.getElementById('presenceThresholdValue');
    // Map mode radio buttons
    const mapModeRadios = document.querySelectorAll('input[name="mapMode"]');

    // Subsector boundary visibility checkbox
    const boundaryCheckbox = document.getElementById('showBoundaries');
    if (boundaryCheckbox) {
        boundaryCheckbox.checked = showBoundaries;
        boundaryCheckbox.addEventListener('change', () => {
            showBoundaries = boundaryCheckbox.checked;
            drawHexGrid();
            updateEncodedSeedString();
        });
    }


    // Single world generator controls
    const generateWorldBtn = document.getElementById('generateWorldBtn');
    const worldOutput = document.getElementById('worldOutput');
    if (generateWorldBtn) {
        generateWorldBtn.addEventListener('click', () => {
            const world = generateWorld();
            const uwpStr = worldToUWP(world);
            worldOutput.textContent = uwpStr + '\n' + formatWorldInfo(world);
        });
    }

    // Tooltip functionality has been disabled.  Previously, world details were
    // shown on mouseover, but the user requested that detailed information
    // instead be displayed on the map itself.  We still keep a reference
    // to the tooltip element in case future features need it, but no
    // mousemove or mouseleave handlers are registered here.
    const tooltipEl = document.getElementById('tooltip');
    // Ensure tooltip is hidden by default
    if (tooltipEl) {
        tooltipEl.style.display = 'none';
    }

    // Hex grid configuration
    // Each subsector contains a fixed number of columns and rows of hexes
    let subCols = 8;    // columns per subsector (west–east)
    let subRows = 10;   // rows per subsector (north–south)
    // A sector is comprised of multiple subsectors.  Adjust these values to
    // control how many subsectors appear horizontally and vertically.
    let subSectorCols = 4; // number of subsectors across
    let subSectorRows = 4; // number of subsectors down
    // Total number of columns and rows in the entire sector
    let cols = subCols * subSectorCols;
    let rows = subRows * subSectorRows;
    // Maximum canvas dimensions used to scale the grid.  The drawing code
    // computes an appropriate hex side length so that the entire sector
    // fits within these bounds.  Feel free to increase these values for
    // higher‑resolution output.
    const maxCanvasWidth = 1200;
    const maxCanvasHeight = 1200;

    // Simulation parameters
    // Each run uses a deposit grid derived from the cell count and a base size.
    // To avoid perfectly symmetric patterns, runSimulation() adds small random
    // offsets to the grid dimensions.  Those dimensions are therefore
    // determined inside runSimulation().
    const depositCellSize = 10; // base size in simulation grid cells per hex
    const agentCount = 300;      // number of agents to simulate
    const iterations = 200;      // number of simulation steps (reduced for performance with multiple subsectors)
    const sensorDistance = 2;    // sensor distance in deposit grid cells
    const sensorAngle = 0.5;     // angle offset (radians) for left/right sensors (approx 28.6°)
    const rotationAngle = 0.3;   // how sharply agents turn towards higher deposit (radians ≈ 17°)
    const stepSize = 1;          // move distance per step (in deposit grid cells)
    const depositAmount = 1;     // deposit amount added at each agent position
    const diffusionRate = 0.2;   // diffusion rate for trail (controls how quickly trail spreads)
    const decayRate = 0.96;      // decay factor for trail each iteration (multiplier < 1)

    // Internal state: array of length cols*rows storing accumulated trail per hex
    let cellIntensities = new Array(cols * rows).fill(0);

    // State for UI features
    // Current zoom factor; used to scale the canvas via CSS transform
    let zoomFactor = 1.3;
    // Currently selected subsector for highlighting and export; null when none
    let selectedSubsector = null;
    // Export scale: how many times larger the exported PNG should be compared
    // with the on‑screen canvas.  Increase this for higher resolution output.
    const exportScale = 3;
    // Store the side length computed in drawHexGrid for click detection and
    // export calculations
    let currentSideLen = 0;
    // Simulation scale factor controlling agent sensor distance and step size
    let simulationScale = 1.0;
    // Display mode: 'density' shows world presence; 'dm' shows world occurrence DM values
    let displayMode = 'density';
    // Whole world generation is derived from display mode.
    generateWholeWorlds = displayMode === 'density';
    // Saturate factor: controls brightness bias.  >1 brightens, <1 darkens.
    let saturateFactor = 1.0;

    // Printable mode: when true, hex cells are rendered using dot patterns
    // instead of solid greys.  This makes the map more suitable for
    // black‑and‑white printing.  Default is false.
    let printableMode = false;
    // showBoundaries, generateWholeWorlds and worlds are declared earlier near the
    // top of the DOMContentLoaded handler.

    // Seeded random number generator state.  To reproduce patterns, we use a
    // simple linear congruential generator (LCG) instead of Math.random()
    // during the simulation.  currentSeed holds the seed used for the
    // current map.  rngState stores the internal state of the LCG.
    let currentSeed = 0;
    let rngState = 0;

    // Presence threshold: minimum quantised level (1‑indexed) for a world to be present
    let presenceThresholdVal = parseInt(presenceSlider.value, 10);
    // Map mode: 'single' for a 4x4 sector; 'vastness' for an expanded sector
    let mapMode = 'single';

    function applyMapMode(newMode, { regenerate = false } = {}) {
        if (!newMode || newMode === mapMode) {
            return;
        }
        mapMode = newMode;
        mapModeRadios.forEach((radio) => {
            radio.checked = (radio.value === mapMode);
        });
        if (mapMode === 'single') {
            subSectorCols = 4;
            subSectorRows = 4;
        } else {
            // Expand to a larger sector: 8×8 subsectors for vastness
            subSectorCols = 8;
            subSectorRows = 8;
        }
        // Recalculate totals
        cols = subCols * subSectorCols;
        rows = subRows * subSectorRows;
        // Reset selected subsector and hide download button
        selectedSubsector = null;
        downloadSubsectorBtn.style.display = 'none';
        // Resize the intensities array
        cellIntensities = new Array(cols * rows).fill(0);
        if (regenerate) {
            generateMap();
        }
    }

    /**
     * Update the encoded seed string displayed in the seed input and
     * seed display.  Uses the current bit depth, simulation scale,
     * density, density threshold, generation mode, map mode, overlays
     * and numeric seed.  Does not change the numeric seed.  Call this
     * whenever UI controls change so the prefix reflects the latest
     * parameters.
     */
    function updateEncodedSeedString() {
        const levels = bitDepthSlider.value;
        const scaleVal = parseFloat(simScaleSlider.value).toFixed(1);
        const densityVal = parseFloat(saturateSlider.value).toFixed(1);
        const thresholdVal = parseInt(presenceSlider.value, 10);
        const modeCode = (displayMode === 'dm') ? 'o' : 'g';
        const mapCode = (mapMode === 'vastness') ? 'v' : 's';
        const boundaryCode = showBoundaries ? 'b' : 'n';
        // Encode printable mode as 'p' for printable and 'n' for normal
        const printableCode = printableMode ? 'p' : 'n';
        const encoded = `${levels}-${scaleVal}-${densityVal}-${thresholdVal}-${modeCode}-${mapCode}-${boundaryCode}-${printableCode}-${currentSeed}`;
        seedInput.value = encoded;
        seedDisplay.textContent = `Seed ${encoded}`;
    }

    /**
     * Initialise the seeded RNG with a 32‑bit integer seed.  All random
     * numbers used in runSimulation() will be derived from this state.
     * Using a deterministic generator allows users to reproduce maps by
     * specifying the same seed.
     * @param {number} seed – the initial seed value
     */
    function setSeed(seed) {
        // Ensure the seed is a 32‑bit unsigned integer
        rngState = (seed >>> 0);
    }

    /**
     * Generate a pseudorandom number in [0,1) using a simple LCG.
     * Each call updates the internal state.  See Numerical Recipes for
     * constants.  We return a float by dividing by 2^32.
     * @returns {number} a pseudorandom float in [0,1)
     */
    function seededRandom() {
        // LCG parameters: same as in glibc
        rngState = (rngState * 1664525 + 1013904223) >>> 0;
        return rngState / 4294967296;
    }

    // Expose the seeded RNG to worldgen.js so that world generation can
    // consume the same deterministic random numbers.  If window.seededRandom
    // is already defined we overwrite it to ensure consistency.
    if (typeof window !== 'undefined') {
        window.seededRandom = seededRandom;
    }

    /**
     * Run the slime‑mold simulation on a small 2D grid.  Returns a flat array
     * of length simWidth × simHeight representing the amount of trail at each
     * cell after diffusion and decay.  Uses a simplified version of the
     * agent‑based Physarum algorithm: each agent senses the pheromone field
     * straight ahead and slightly to the left and right, turns toward the
     * strongest signal, moves forward, deposits trail, and the trail
     * diffuses and decays.
     */
    function runSimulation(nCols = subCols, nRows = subRows) {
        // Determine grid dimensions with small random offsets to avoid symmetric
        // patterns.  The base dimension is number of hex columns/rows times the
        // depositCellSize plus a random offset between 1 and 4.
        // Use seeded random numbers to determine small offsets; ensures
        // determinism when a seed is provided.  Offsets in the range [1,4].
        const randOffX = Math.floor(seededRandom() * 4) + 1;
        const randOffY = Math.floor(seededRandom() * 4) + 1;
        const simWidth = nCols * depositCellSize + randOffX;
        const simHeight = nRows * depositCellSize + randOffY;

        // Create deposit field and scratch buffer for diffusion
        const deposit = new Float32Array(simWidth * simHeight);
        const newDeposit = new Float32Array(simWidth * simHeight);

        // Initialise deposit with a little random noise to break symmetry
        for (let i = 0; i < deposit.length; i++) {
            deposit[i] = seededRandom() * 0.01;
        }

        // Determine scaled parameters based on simulation scale factor.  We
        // multiply the sensor distance and step size by simulationScale and
        // also scale the rotation angle proportionally for consistent
        // behaviour across scales.
        const sDistScaled = sensorDistance * simulationScale;
        const stepScaled = stepSize * simulationScale;
        const rotScaled = rotationAngle * simulationScale;
        const sensorAngleScaled = sensorAngle; // keep sensor angle constant

        // Initialise agents at random positions and headings
        const agents = [];
        for (let i = 0; i < agentCount; i++) {
            agents.push({
                x: seededRandom() * simWidth,
                y: seededRandom() * simHeight,
                angle: seededRandom() * Math.PI * 2
            });
        }

        // Helper to sample deposit at floating coordinates with clamping
        function sampleAt(x, y) {
            const xi = Math.floor(x);
            const yi = Math.floor(y);
            if (xi < 0 || xi >= simWidth || yi < 0 || yi >= simHeight) {
                return 0;
            }
            return deposit[yi * simWidth + xi];
        }

        // Main simulation loop
        for (let iter = 0; iter < iterations; iter++) {
            // Agents: sense, turn, move, deposit
            for (let a = 0; a < agentCount; a++) {
                const agent = agents[a];
                // Sample deposit at sensors: ahead, left, right
                const ax = agent.x;
                const ay = agent.y;
                const heading = agent.angle;
                // centre sensor
                const cx = ax + Math.cos(heading) * sDistScaled;
                const cy = ay + Math.sin(heading) * sDistScaled;
                const centre = sampleAt(cx, cy);
                // left sensor
                const lx = ax + Math.cos(heading - sensorAngleScaled) * sDistScaled;
                const ly = ay + Math.sin(heading - sensorAngleScaled) * sDistScaled;
                const left = sampleAt(lx, ly);
                // right sensor
                const rx = ax + Math.cos(heading + sensorAngleScaled) * sDistScaled;
                const ry = ay + Math.sin(heading + sensorAngleScaled) * sDistScaled;
                const right = sampleAt(rx, ry);
                // Turn based on sensor readings
                if (centre > left && centre > right) {
                    // keep going straight
                } else if (left > right) {
                    agent.angle -= rotScaled;
                } else if (right > left) {
                    agent.angle += rotScaled;
                } else {
                    // When all are equal or centre lowest, randomise direction slightly
                    agent.angle += (seededRandom() - 0.5) * rotScaled;
                }
                // Move forward
                agent.x += Math.cos(agent.angle) * stepScaled;
                agent.y += Math.sin(agent.angle) * stepScaled;
                // Reflective boundaries: bounce agents off the edges to
                // prevent perfectly symmetric wrap‑around patterns
                if (agent.x < 0) {
                    agent.x = 0;
                    agent.angle = Math.PI - agent.angle;
                } else if (agent.x >= simWidth - 1) {
                    agent.x = simWidth - 1;
                    agent.angle = Math.PI - agent.angle;
                }
                if (agent.y < 0) {
                    agent.y = 0;
                    agent.angle = -agent.angle;
                } else if (agent.y >= simHeight - 1) {
                    agent.y = simHeight - 1;
                    agent.angle = -agent.angle;
                }
                // Deposit trail
                const ix = Math.floor(agent.x);
                const iy = Math.floor(agent.y);
                deposit[iy * simWidth + ix] += depositAmount;
            }
            // Diffuse and decay the deposit field
            for (let y = 0; y < simHeight; y++) {
                for (let x = 0; x < simWidth; x++) {
                    const idx = y * simWidth + x;
                    // Compute sum of four neighbors (wrap for diffusion)
                    const up = deposit[((y - 1 + simHeight) % simHeight) * simWidth + x];
                    const down = deposit[((y + 1) % simHeight) * simWidth + x];
                    const leftVal = deposit[y * simWidth + ((x - 1 + simWidth) % simWidth)];
                    const rightVal = deposit[y * simWidth + ((x + 1) % simWidth)];
                    const average = (up + down + leftVal + rightVal) * 0.25;
                    // Apply diffusion and decay
                    let val = deposit[idx] + diffusionRate * (average - deposit[idx]);
                    val *= decayRate;
                    newDeposit[idx] = val;
                }
            }
            // Swap buffers by copying newDeposit back into deposit
            deposit.set(newDeposit);
        }
        // Return deposit field and its dimensions
        return { deposit, width: simWidth, height: simHeight };
    }

    /**
     * Convert the deposit field into per‑hex cell intensities.  Each hex cell
     * corresponds to a block of depositCellSize × depositCellSize in the
     * deposit grid.  The sum of deposit values in that block represents the
     * accumulated trail for the hex.
     * @param {Float32Array} deposit – the deposit field
     */
    function accumulateToCells(simData, nCols = subCols, nRows = subRows) {
        const { deposit, width, height } = simData;
        const intensities = new Array(nCols * nRows).fill(0);
        // Determine how many simulation grid cells correspond to each hex cell
        const cellW = width / nCols;
        const cellH = height / nRows;
        for (let y = 0; y < height; y++) {
            const rowIndex = Math.floor(y / cellH);
            for (let x = 0; x < width; x++) {
                const colIndex = Math.floor(x / cellW);
                const idx = y * width + x;
                const cellIndex = rowIndex * nCols + colIndex;
                intensities[cellIndex] += deposit[idx];
            }
        }
        return intensities;
    }

    /**
     * Compute min/max intensity ranges for each subsector. Normalising
     * per-subsector keeps world visibility consistent when the map grows
     * from a single sector to a multi-sector layout.
     */
    function computeSubsectorRanges() {
        const ranges = new Array(subSectorCols * subSectorRows);
        for (let sy = 0; sy < subSectorRows; sy++) {
            for (let sx = 0; sx < subSectorCols; sx++) {
                let minVal = Infinity;
                let maxVal = -Infinity;
                for (let r = 0; r < subRows; r++) {
                    for (let c = 0; c < subCols; c++) {
                        const globalRow = sy * subRows + r;
                        const globalCol = sx * subCols + c;
                        const val = cellIntensities[globalRow * cols + globalCol];
                        if (val < minVal) minVal = val;
                        if (val > maxVal) maxVal = val;
                    }
                }
                ranges[sy * subSectorCols + sx] = { minVal, maxVal };
            }
        }
        return ranges;
    }

    /**
     * Draw the hex grid using the current cell intensities and bit depth.
     */
    function drawHexGrid() {
        // Determine how many discrete colour levels to use.  The slider
        // directly specifies the number of levels (2 = black & white,
        // 3 = black, grey & white, …, up to 16).  Values are clamped to
        // [2, 16] via the input element attributes.
        const levels = parseInt(bitDepthSlider.value, 10);
        // Precompute constants for flat‑top orientation using an odd‑q
        // offset.  In Traveller/Cepheus maps, the hexes are flat topped
        // with columns offset vertically by half a row: odd columns are
        // shifted down by ½ of the vertical spacing.  Each hex has
        // width = 2*sideLen and height = √3*sideLen.  Centres of adjacent
        // columns are spaced horizontally by 1.5*sideLen and adjacent rows
        // by height (verticalSpacing = √3*sideLen).  Odd columns (1‑indexed)
        // are shifted downward by half of the vertical spacing.  We derive
        // a side length that allows the entire sector (including the half
        // offset at the bottom) to fit within the maximum canvas dimensions.
        // The total width of the grid is (1.5 * cols + 0.5) × sideLen and
        // the total height is (rows + 0.5) × height.  See derivation in
        // the report for details.
        const sqrt3 = Math.sqrt(3);
        // Candidate side length constrained by horizontal space.
        // width = (1.5 * cols + 0.5) × sideLen
        const sideLenW = maxCanvasWidth / (1.5 * cols + 0.5);
        // Candidate side length constrained by vertical space.  With a
        // half‑row offset, the total height of the grid is
        // (rows + 0.5) × height = (rows + 0.5) × √3 × sideLen.
        // ⇒ sideLen = maxCanvasHeight / ((rows + 0.5) × √3).
        const sideLenH = maxCanvasHeight / ((rows + 0.5) * sqrt3);
        const sideLen = Math.min(sideLenW, sideLenH);
        // Record current side length for click detection and export calculations
        currentSideLen = sideLen;
        // Derived metrics for flat orientation
        const hexWidth = 2 * sideLen;
        const hexHeight = sqrt3 * sideLen;
        const horizSpacing = 1.5 * sideLen;
        const verticalSpacing = hexHeight; // distance between row centres
        // Compute canvas size.  The width stays the same as before.  The
        // height accounts for the half‑row offset on the last columns.
        const canvasWidth = (1.5 * cols + 0.5) * sideLen;
        const canvasHeight = (rows + 0.5) * hexHeight;
        // Hi‑DPI scaling with zoom: adjust the internal canvas resolution based
        // on both device pixel ratio and the current zoom factor.  By
        // allocating a larger backing store proportional to zoomFactor we
        // maintain crisp lines at any zoom level without relying on CSS
        // transforms.  The CSS width/height of the canvas are also scaled
        // so the on‑screen size matches the zoom factor.  We then scale
        // drawing operations by the combined factor to map world units to
        // device pixels correctly.
        const dpr = window.devicePixelRatio || 1;
        const internalScale = dpr * zoomFactor;
        const scaledW = canvasWidth * internalScale;
        const scaledH = canvasHeight * internalScale;
        // Only resize the canvas if necessary (avoids clearing on every draw)
        if (canvas.width !== scaledW || canvas.height !== scaledH) {
            canvas.width = scaledW;
            canvas.height = scaledH;
            // Set CSS size to account for zoom
            canvas.style.width = (canvasWidth * zoomFactor) + 'px';
            canvas.style.height = (canvasHeight * zoomFactor) + 'px';
        }
        // Scale the context so one unit in our world coordinate system
        // corresponds to internalScale pixels.  The transform resets
        // translation to the origin (0,0).
        ctx.setTransform(internalScale, 0, 0, internalScale, 0, 0);
        const subsectorRanges = computeSubsectorRanges();
        // Clear canvas (in unscaled coordinate system)
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        // Loop through every cell to draw the hex, fill colour, labels
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                const val = cellIntensities[index];
                const sx = Math.floor(col / subCols);
                const sy = Math.floor(row / subRows);
                const { minVal, maxVal } = subsectorRanges[sy * subSectorCols + sx];
                // Normalise deposit to [0,1]
                let norm = 0;
                if (maxVal > minVal) {
                    norm = (val - minVal) / (maxVal - minVal);
                }
                // Apply saturate factor: raise to power 1/saturateFactor to bias
                // the distribution.  Values >1 brighten (increase lighter areas);
                // values <1 darken.  A factor of 1 leaves norm unchanged.
                if (saturateFactor !== 1) {
                    // clamp to [0,1] for safety
                    norm = Math.min(1, Math.max(0, Math.pow(norm, 1 / saturateFactor)));
                }
                // Quantise into discrete levels
                let level = Math.floor(norm * (levels - 1));
                if (level < 0) level = 0;
                if (level >= levels) level = levels - 1;
                // Map to grayscale: 0 = black, levels-1 = white
                const gray = levels > 1 ? Math.floor((level / (levels - 1)) * 255) : 0;
                ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
                // Compute centre of the hex.  Start with base x coordinate so the
                // leftmost vertex of the leftmost column is at x=0.  Centres
                // are at col * horizSpacing + sideLen.
                const cx = col * horizSpacing + sideLen;
                // Compute vertical offset: in the odd‑q offset, odd columns
                // are shifted down by half a row (½ × verticalSpacing).  The
                // centre y coordinate is then (row + offset) × verticalSpacing
                // + half the hex height.  offsetRows is 0 for even columns
                // and 0.5 for odd columns (col is zero‑based).
                const offsetRows = (col % 2) * 0.5;
                const cy = (row + offsetRows) * verticalSpacing + hexHeight / 2;
                // Draw the hexagon with flat‑top orientation.  The six
                // vertices are at angles 0°, 60°, 120°, 180°, 240°, 300°.
                ctx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const angleRad = (Math.PI / 180) * (60 * k);
                    const x = cx + sideLen * Math.cos(angleRad);
                    const y = cy + sideLen * Math.sin(angleRad);
                    if (k === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.closePath();
                if (!printableMode) {
                    // Solid fill for normal mode
                    ctx.fill();
                } else {
                    // Printable mode: no shading or fill; just leave the
                    // cell background blank so only DM values are visible.
                    // The border will be drawn below to outline the hex.
                }
                // Always draw a thin border around each hex for
                // legibility, even in printable mode.  Use a
                // semi‑transparent stroke so the outlines are visible but
                // unobtrusive.  Rendering the outline after any fill
                // ensures it appears on top.
                // Use a slightly darker outline in printable mode for better
                // contrast.  In normal mode, keep it lighter.  The border
                // ensures hex shapes remain visible on top of shading.
                const borderOpacity = printableMode ? 0.6 : 0.3;
                ctx.strokeStyle = `rgba(0, 0, 0, ${borderOpacity})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
                // Compute world presence and generate world if needed
                const worldPresent = (level + 1) >= presenceThresholdVal;
                let primaryText = '';
                let secondaryText = '';
                let tertiaryText = '';
                let tertiaryColour = null;
                // Generate or retrieve the world for this cell if whole‑world mode is enabled
                if (generateWholeWorlds && worldPresent) {
                    if (!worlds[index]) {
                        worlds[index] = generateWorld();
                    }
                    const world = worlds[index];
                    secondaryText = worldToUWP(world);
                    // Construct tertiary text from trade codes and base codes
                    const codes = [];
                    if (world.tradeCodes && world.tradeCodes.length > 0) {
                        codes.push(...world.tradeCodes);
                    }
                    if (world.bases && world.bases.length > 0) {
                        codes.push(...world.bases);
                    }
                    if (codes.length > 0) {
                        tertiaryText = codes.join(' ');
                        // Determine colour of tertiary text: if any trade code is in the red list, colour red; else if any in amber, colour orange.
                        const redCodes = ['In', 'Hi', 'Ht', 'Va', 'Ri'];
                        const amberCodes = ['Ag', 'As', 'Ba', 'De', 'Fl', 'Ic', 'Na', 'Ni', 'Lo', 'Lt', 'Po', 'Wa', 'Ga'];
                        if (world.tradeCodes && world.tradeCodes.some(tc => redCodes.includes(tc))) {
                            tertiaryColour = 'red';
                        } else if (world.tradeCodes && world.tradeCodes.some(tc => amberCodes.includes(tc))) {
                            tertiaryColour = 'orange';
                        }
                    }
                }
                if (displayMode === 'dm') {
                    // Map the quantised level into four bands corresponding to DM modifiers
                    const quartSize = levels / 4;
                    let region = Math.floor(level / quartSize);
                    if (region < 0) region = 0;
                    if (region > 3) region = 3;
                    const dmValue = -2 + region;
                    if (dmValue > 0) {
                        primaryText = `+${dmValue}`;
                    } else if (dmValue === 0) {
                        primaryText = '+0';
                    } else {
                        primaryText = dmValue.toString();
                    }
                } else {
                    // Density mode: show a star when no world code is displayed
                    if (!secondaryText) {
                        primaryText = worldPresent ? '★' : '';
                    }
                }
                // Choose text colour: black on light greys, white on dark greys, dark in printable mode
                const densityColour = printableMode ? '#000' : ((gray > 128) ? '#000' : '#fff');
                ctx.fillStyle = densityColour;
                ctx.textAlign = 'center';
                // Draw primary text at the centre
                ctx.font = `${(sideLen * 0.35).toFixed(2)}px sans-serif`;
                ctx.textBaseline = 'middle';
                ctx.fillText(primaryText, cx, cy);
                // Draw secondary text (world code) below the primary text if present.
                // Increase vertical offsets to prevent overlap with tertiary text.  Use
                // larger fractional offsets from the centre; adjust tertiary Y accordingly.
                let currentY = cy;
                if (secondaryText) {
                    ctx.font = `${(sideLen * 0.25).toFixed(2)}px monospace`;
                    ctx.textBaseline = 'top';
                    // Position the UWP code further down from centre to allow more room for tertiary text
                    const secondaryY = cy + sideLen * 0.35;
                    ctx.fillText(secondaryText, cx, secondaryY);
                    currentY = secondaryY;
                }
                // Draw tertiary text (trade/base codes) below the secondary text
                if (tertiaryText) {
                    // Set colour based on classification; default to densityColour
                    ctx.fillStyle = tertiaryColour || densityColour;
                    ctx.font = `${(sideLen * 0.20).toFixed(2)}px monospace`;
                    ctx.textBaseline = 'top';
                    // If secondary text exists, position tertiary further down to avoid overlap.
                    // Otherwise, position tertiary text at a moderate offset below centre.
                    const tertiaryY = secondaryText ? cy + sideLen * 0.58 : cy + sideLen * 0.35;
                    ctx.fillText(tertiaryText, cx, tertiaryY);
                    // Reset colour for subsequent drawing
                    ctx.fillStyle = densityColour;
                }
                // Draw coordinate label at the top of the hex.  Coordinates are
                // 2‑digit column followed by 2‑digit row numbers (01–08, 01–10).
                // Compute local coordinates for the subsector.  The user
                // requested that cell coordinates repeat within each
                // 8×10 subsector, so the labels are based on the
                // remainder of the global indices.  Column values run
                // 01–08 and row values run 01–10 in every subsector.
                const localCol = (col % subCols) + 1;
                const localRow = (row % subRows) + 1;
                const colStr = String(localCol).padStart(2, '0');
                const rowStr = String(localRow).padStart(2, '0');
                const coordLabel = `${colStr}${rowStr}`;
                // Use a fixed bright colour for coordinate labels so they
                // contrast with the grayscale background regardless of level.
                ctx.fillStyle = '#FF6600';
                ctx.font = `${(sideLen * 0.25).toFixed(2)}px sans-serif`;
                // Position the coordinate label above the centre (closer to the
                // top edge).  For flat‑top hexes, moving up by 0.5*sideLen
                // approximately places the text near the top third of the cell.
                const coordY = cy - sideLen * 0.6;
                ctx.fillText(coordLabel, cx, coordY);
            }
        }
        // Draw subsector boundaries along hex edges.  Instead of straight
        // lines, we highlight the appropriate edges of boundary cells.  We
        // iterate through all cells again and, for cells on a vertical
        // boundary (the last column of a subsector), draw their right
        // edges; for cells on a horizontal boundary (the last row of a
        // subsector), draw their bottom edges.  This produces a zigzag
        // boundary that follows the hex geometry.  Boundary colour
        // matches the previous blue used for straight lines.
        // Set boundary colour and width based on toggle.  When boundaries
        // are hidden, use a fully transparent colour and zero width so
        // nothing is drawn.
        const boundaryColour = showBoundaries ? '#0088CC' : 'rgba(0,0,0,0)';
        ctx.strokeStyle = boundaryColour;
        const boundaryWidth = showBoundaries ? 2 : 0;
        // loop again to draw boundary edges
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // compute centre as before
                const index = row * cols + col;
                const offsetRows = (col % 2) * 0.5;
                const cx = col * horizSpacing + sideLen;
                const cy = (row + offsetRows) * verticalSpacing + hexHeight / 2;
                // compute vertices of the hex for later use
                const verts = [];
                for (let k = 0; k < 6; k++) {
                    const angleRad = (Math.PI / 180) * (60 * k);
                    const x = cx + sideLen * Math.cos(angleRad);
                    const y = cy + sideLen * Math.sin(angleRad);
                    verts.push({ x, y });
                }
                // vertical boundaries: highlight right edges for the last
                // column in each subsector
                if ((col + 1) % subCols === 0 && col !== cols - 1) {
                    // Right boundary: draw edges from vertex 0 to 1 (top-right)
                    // and from vertex 0 to 5 (bottom-right).
                    ctx.beginPath();
                    ctx.lineWidth = boundaryWidth;
                    ctx.moveTo(verts[0].x, verts[0].y);
                    ctx.lineTo(verts[1].x, verts[1].y);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.lineWidth = boundaryWidth;
                    ctx.moveTo(verts[0].x, verts[0].y);
                    ctx.lineTo(verts[5].x, verts[5].y);
                    ctx.stroke();
                }
                // horizontal boundaries: draw edges along the bottom of
                // the last row of each subsector.  In a flat‑top odd‑q
                // layout, adjacent columns have bottom edges at two
                // different heights (odd columns are shifted down by
                // half a row).  To produce a continuous zig‑zag
                // boundary between subsectors, we draw the bottom
                // horizontal edge of every boundary cell and connect
                // neighbouring cells with diagonals.  Specifically,
                // for each cell where (row+1) % subRows === 0 and
                // row < rows − 1 (i.e. the last row of a subsector), we:
                //   • draw the bottom horizontal edge (vertex 1→2);
                //   • if the column is odd (zero‑based), draw a
                //     bottom‑left diagonal (vertex 3→2) to connect
                //     downwards to the preceding even column;
                //   • if the column is even, draw a bottom‑right
                //     diagonal (vertex 1→0) to connect downwards to
                //     the following odd column.
                const isBoundaryRow = (((row + 1) % subRows) === 0) && (row < rows - 1);
                if (isBoundaryRow) {
                    // Bottom horizontal: vertex 1 → vertex 2 (south‑east to south‑west)
                    ctx.beginPath();
                    ctx.lineWidth = boundaryWidth;
                    ctx.moveTo(verts[1].x, verts[1].y);
                    ctx.lineTo(verts[2].x, verts[2].y);
                    ctx.stroke();
                    // Diagonal connections for zig‑zag.  Odd columns (1‑based)
                    // draw both bottom‑left and bottom‑right diagonals to
                    // connect to adjacent even columns.  Even columns do not
                    // draw any diagonals here; their neighbours provide the
                    // connecting segments.
                    if (col % 2 === 1) {
                        // Bottom‑left diagonal (vertex 3 → vertex 2)
                        ctx.beginPath();
                        ctx.lineWidth = boundaryWidth;
                        ctx.moveTo(verts[3].x, verts[3].y);
                        ctx.lineTo(verts[2].x, verts[2].y);
                        ctx.stroke();
                        // Bottom‑right diagonal (vertex 1 → vertex 0)
                        ctx.beginPath();
                        ctx.lineWidth = boundaryWidth;
                        ctx.moveTo(verts[1].x, verts[1].y);
                        ctx.lineTo(verts[0].x, verts[0].y);
                        ctx.stroke();
                    }
                }
            }
        }
        // If a subsector is selected, draw a semi‑transparent highlight over it.
        // We need to compute the pixel bounds based on local offsets and
        // vertical/horizontal spacing.  Each subsector spans subCols columns
        // and subRows rows, but due to the odd‑q offset, the top-left
        // coordinate depends on whether the first column of the subsector is
        // odd or even.  To keep it simple, we compute the bounding box
        // covering all cells in the subsector and draw a rectangle.  This
        // outline may not perfectly align with hex edges but serves as a
        // highlight overlay only.
        if (selectedSubsector !== null) {
            const sx = selectedSubsector.sx;
            const sy = selectedSubsector.sy;
            // compute bounding box for subsector in pixel coordinates
            // left column index and top row index
            const startCol = sx * subCols;
            const startRow = sy * subRows;
            // rightmost column index (exclusive)
            const endCol = startCol + subCols;
            const endRow = startRow + subRows;
            // find min and max x,y by checking the top-left hex and bottom-right hex
            // top-left cell centre
            const tlOffsetRows = (startCol % 2) * 0.5;
            const tlcx = startCol * horizSpacing + sideLen;
            const tlcy = (startRow + tlOffsetRows) * verticalSpacing + hexHeight / 2;
            // compute topmost y coordinate: top vertex of tl cell
            const tlTop = tlcy + sideLen * Math.sin((Math.PI / 180) * 120); // vertex 2 (north-west)
            // compute leftmost x coordinate: left vertex of tl cell
            const tlLeft = tlcx + sideLen * Math.cos((Math.PI / 180) * 180);
            // bottom-right cell centre
            const brCol = endCol - 1;
            const brRow = endRow - 1;
            const brOffsetRows = (brCol % 2) * 0.5;
            const brcx = brCol * horizSpacing + sideLen;
            const brcy = (brRow + brOffsetRows) * verticalSpacing + hexHeight / 2;
            // compute bottom y coordinate: bottom vertex of br cell (vertex 4)
            const brBottom = brcy + sideLen * Math.sin((Math.PI / 180) * 240);
            // compute rightmost x coordinate: right vertex of br cell (vertex 0)
            const brRight = brcx + sideLen;
            // draw semi-transparent overlay
            ctx.fillStyle = 'rgba(255, 255, 0, 0.15)';
            ctx.fillRect(tlLeft, tlTop, brRight - tlLeft, brBottom - tlTop);
        }
    }

    /**
     * Generate a new map: run the simulation, accumulate deposit to hex cells,
     * and redraw.
     */
    function generateMap() {
        // Reset the RNG to the current seed to ensure deterministic results.
        setSeed(currentSeed);
        // Initialise the global cell intensities array for the entire sector
        cellIntensities = new Array(cols * rows).fill(0);
        // Reset the worlds array to ensure fresh world generation for each cell
        worlds = new Array(cols * rows).fill(null);
        // For each subsector, run a separate simulation and accumulate its
        // results into the global grid.  This produces varied patterns across
        // the sector while still using the Physarum algorithm within each
        // subsector.
        for (let sy = 0; sy < subSectorRows; sy++) {
            for (let sx = 0; sx < subSectorCols; sx++) {
                const simData = runSimulation(subCols, subRows);
                const subIntensities = accumulateToCells(simData, subCols, subRows);
                // Copy the subsector intensities into the correct location in
                // the global cell array
                for (let r = 0; r < subRows; r++) {
                    for (let c = 0; c < subCols; c++) {
                        const globalRow = sy * subRows + r;
                        const globalCol = sx * subCols + c;
                        cellIntensities[globalRow * cols + globalCol] = subIntensities[r * subCols + c];
                    }
                }
            }
        }
        drawHexGrid();
    }

    // Convert a Traveller world object into an 8‑character UWP code.  Uses
    // hexadecimal notation for numeric fields (0–15).  Starport letter
    // appears first followed by size, atmosphere, hydrographics,
    // population, government, law and tech level.
    function worldToUWP(world) {
        function toHex(n) {
            const clamped = Math.max(0, Math.min(15, n));
            return clamped.toString(16).toUpperCase();
        }
        // Construct the base UWP string
        let uwp = `${world.starport}${toHex(world.size)}${toHex(world.atmosphere)}${toHex(world.hydrographics)}${toHex(world.population)}${toHex(world.government)}${toHex(world.law)}${toHex(world.techLevel)}`;
        // If a gas giant is present in the system, append an asterisk after the
        // tech level to indicate it【435193721292873†L21-L30】.
        if (world.gasGiant) {
            uwp += '*';
        }
        return uwp;
    }

    // Format world information into a multi-line string for tooltips and the
    // single world generator output.  Includes the UWP, starport, size,
    // atmosphere, hydrographics, population, government, law level, tech
    // level, trade codes and bases if present.
    function formatWorldInfo(world) {
        const lines = [];
        //lines.push(`UWP: ${worldToUWP(world)}`);
        lines.push(`Starport: ${world.starport}`);
        lines.push(`Size: ${world.size}`);
        lines.push(`Atmosphere: ${world.atmosphere}`);
        lines.push(`Hydrographics: ${world.hydrographics}`);
        lines.push(`Population: ${world.population}`);
        lines.push(`Government: ${world.government}`);
        lines.push(`Law: ${world.law}`);
        lines.push(`Tech Level: ${world.techLevel}`);
        // Indicate gas giant presence
        lines.push(`Gas Giant: ${world.gasGiant ? 'Yes' : 'No'}`);
        if (world.tradeCodes && world.tradeCodes.length > 0) {
            lines.push(`Trade Codes: ${world.tradeCodes.join(', ')}`);
        }
        if (world.bases && world.bases.length > 0) {
            lines.push(`Bases: ${world.bases.join(', ')}`);
        }
        return lines.join('\n');
    }

    // Approximate mapping from world-space (canvas) coordinates to hex grid
    // coordinates.  Returns an object with row and col or null if outside the grid.
    function getHexAtPoint(px, py) {
        const sqrt3 = Math.sqrt(3);
        const sideLen = currentSideLen;
        const horizSpacing = 1.5 * sideLen;
        const verticalSpacing = sqrt3 * sideLen;
        // Compute approximate column based on x coordinate.
        const approxCol = Math.floor((px - sideLen) / horizSpacing);
        if (approxCol < 0 || approxCol >= cols) return null;
        // Determine the offset for odd columns
        const offsetRows = (approxCol % 2) * 0.5;
        // Compute approximate row based on y coordinate.
        const approxRow = Math.floor((py - (offsetRows * verticalSpacing) - (sideLen * sqrt3 / 2)) / verticalSpacing);
        if (approxRow < 0 || approxRow >= rows) return null;
        return { col: approxCol, row: approxRow };
    }

    // Update bit depth display and redraw when slider moves.  Also update
    // the encoded seed prefix to reflect the new level.
    bitDepthSlider.addEventListener('input', () => {
        bitDepthValue.textContent = bitDepthSlider.value;
        // Update presence slider max to reflect new number of levels
        presenceSlider.max = bitDepthSlider.value;
        // Clamp threshold if it exceeds new max
        if (presenceThresholdVal > parseInt(bitDepthSlider.value, 10)) {
            presenceThresholdVal = parseInt(bitDepthSlider.value, 10);
            presenceSlider.value = presenceThresholdVal;
            presenceValue.textContent = presenceThresholdVal.toString();
        }
        drawHexGrid();
        updateEncodedSeedString();
    });

    // Generate new map on button click.  If a seed string with encoded
    // parameters is provided in the seedInput field, parse the prefix to
    // restore those settings.  Otherwise generate a new random seed.  After
    // generation, update the seed input with an encoded string that
    // incorporates the current content and display parameters.
    generateBtn.addEventListener('click', () => {
        // Read the seed string and trim whitespace
        const seedStr = seedInput.value.trim();
        let numericSeed;
        // Helper to synchronise UI controls and internal variables
        function updateUIFromParams(levels, scale, saturate, threshold, modeCode, mapCode, boundaryCode, printableCode) {
            // Update bit depth slider and display
            const lvl = parseInt(levels, 10);
            if (!isNaN(lvl)) {
                bitDepthSlider.value = lvl;
                bitDepthValue.textContent = lvl.toString();
                presenceSlider.max = lvl;
                if (presenceThresholdVal > lvl) {
                    presenceThresholdVal = lvl;
                    presenceSlider.value = presenceThresholdVal;
                    presenceValue.textContent = presenceThresholdVal.toString();
                }
            }
            // Update simulation scale
            const sc = parseFloat(scale);
            if (!isNaN(sc)) {
                simScaleSlider.value = sc;
                simScaleValue.textContent = sc.toFixed(1);
                simulationScale = sc;
            }
            // Update saturate factor
            const sat = parseFloat(saturate);
            if (!isNaN(sat)) {
                saturateSlider.value = sat;
                saturateValue.textContent = sat.toFixed(1);
                saturateFactor = sat;
            }
            // Update presence threshold
            const thresholdVal = parseInt(threshold, 10);
            if (!isNaN(thresholdVal)) {
                presenceThresholdVal = thresholdVal;
                presenceSlider.value = thresholdVal;
                presenceValue.textContent = thresholdVal.toString();
            }
            // Update display mode and radio buttons
            if (modeCode === 'o' || modeCode === 'd') {
                displayMode = 'dm';
            } else {
                displayMode = 'density';
            }
            generateWholeWorlds = displayMode === 'density';
            modeRadioButtons.forEach((rb) => {
                rb.checked = (rb.value === displayMode);
            });

            // Update map mode if provided
            if (mapCode !== undefined) {
                applyMapMode((mapCode === 'v') ? 'vastness' : 'single');
            }

            // Update boundary overlay if provided
            if (boundaryCode !== undefined) {
                showBoundaries = (boundaryCode === 'b');
                if (boundaryCheckbox) {
                    boundaryCheckbox.checked = showBoundaries;
                }
            }

            // Update printable mode if provided
            if (printableCode !== undefined) {
                printableMode = (printableCode === 'p');
                printableCheckbox.checked = printableMode;
            }
        }
        if (seedStr !== '') {
            const parts = seedStr.split('-');
            // If the seed string has at least 5 parts, assume it encodes
            // params as levels-scale-density-mode-numericSeed.  Any
            // additional hyphens in the numeric seed are joined back.
            if (parts.length >= 9) {
                // New format: levels-scale-density-threshold-mode-map-boundary-printable-numericSeed
                const levelsPart = parts[0];
                const scalePart = parts[1];
                const densityPart = parts[2];
                const thresholdPart = parts[3];
                const modePart = parts[4];
                const mapPart = parts[5];
                const boundaryPart = parts[6];
                const printablePart = parts[7];
                const seedPart = parts.slice(8).join('-');
                const parsedSeed = parseInt(seedPart, 10);
                numericSeed = isNaN(parsedSeed) ? undefined : (parsedSeed >>> 0);
                // Update UI controls from encoded parameters
                updateUIFromParams(
                    levelsPart,
                    scalePart,
                    densityPart,
                    thresholdPart,
                    modePart,
                    mapPart,
                    boundaryPart,
                    printablePart
                );
            } else if (parts.length >= 6) {
                // Previous format: levels-scale-saturate-mode-printable-numericSeed
                const levelsPart = parts[0];
                const scalePart = parts[1];
                const saturatePart = parts[2];
                const modePart = parts[3];
                const printablePart = parts[4];
                const seedPart = parts.slice(5).join('-');
                const parsedSeed = parseInt(seedPart, 10);
                numericSeed = isNaN(parsedSeed) ? undefined : (parsedSeed >>> 0);
                // Update UI controls from encoded parameters
                updateUIFromParams(levelsPart, scalePart, saturatePart, undefined, modePart, undefined, undefined, printablePart);
            } else if (parts.length >= 5) {
                // Older format: levels-scale-saturate-mode-numericSeed
                const levelsPart = parts[0];
                const scalePart = parts[1];
                const saturatePart = parts[2];
                const modePart = parts[3];
                const seedPart = parts.slice(4).join('-');
                const parsedSeed = parseInt(seedPart, 10);
                numericSeed = isNaN(parsedSeed) ? undefined : (parsedSeed >>> 0);
                updateUIFromParams(levelsPart, scalePart, saturatePart, undefined, modePart);
            } else {
                // Only a numeric seed provided
                const parsed = parseInt(seedStr, 10);
                numericSeed = isNaN(parsed) ? undefined : (parsed >>> 0);
            }
        }
        // If no valid numeric seed extracted, generate a new one
        if (numericSeed === undefined) {
            numericSeed = Math.floor(Math.random() * 0xFFFFFFFF);
        }
        currentSeed = numericSeed;
        // Initialise seeded RNG to ensure deterministic simulation
        setSeed(currentSeed);
        // Disable button temporarily to prevent multiple runs
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating…';
        // Run simulation asynchronously to keep UI responsive
        setTimeout(() => {
            generateMap();
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate from seed';
            // After generation, update the encoded seed prefix to
            // reflect the current parameters and numeric seed.
            updateEncodedSeedString();
        }, 10);
    });

    // Randomize seed button: generate a new random seed and create a
    // fresh map using the current parameters.  After regeneration the
    // encoded seed string is updated.  This does not rely on the
    // contents of the seed input field.
    randomizeBtn.addEventListener('click', () => {
        // Generate a new random seed
        currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
        // Initialise seeded RNG
        setSeed(currentSeed);
        // Temporarily disable the button to avoid multiple clicks
        randomizeBtn.disabled = true;
        randomizeBtn.textContent = 'Randomizing…';
        // Run simulation asynchronously
        setTimeout(() => {
            generateMap();
            randomizeBtn.disabled = false;
            randomizeBtn.textContent = 'Randomize seed';
            // Update encoded seed string to reflect the new random seed
            updateEncodedSeedString();
        }, 10);
    });

    // Download canvas as PNG
    downloadBtn.addEventListener('click', () => {
        // Export the entire sector at a higher resolution
        exportSector();
    });

    // Export only the selected subsector at high resolution
    downloadSubsectorBtn.addEventListener('click', () => {
        if (selectedSubsector) {
            exportSubsector(selectedSubsector.sx, selectedSubsector.sy);
        }
    });

    // Initial render
    bitDepthValue.textContent = bitDepthSlider.value;
    presenceValue.textContent = presenceSlider.value;
    // Generate the first map automatically when the page loads.  Use a
    // random seed and store it so users can reproduce the pattern later.
    currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    // Seeded RNG initialisation
    setSeed(currentSeed);
    // Generate the map using current UI parameters
    generateMap();
    // Build the initial encoded seed string reflecting the current
    // parameters and numeric seed, and update the seed input/display.
    updateEncodedSeedString();

    // Zoom control: instead of using a CSS transform (which causes aliasing
    // artifacts when magnifying), adjust the canvas's internal resolution and
    // CSS size.  When the zoom slider changes, update the global zoomFactor,
    // update the displayed value and redraw the grid.  drawHexGrid() will
    // resize the canvas based on zoomFactor and devicePixelRatio to keep
    // lines crisp at any zoom level.
    zoomSlider.addEventListener('input', () => {
        zoomFactor = parseFloat(zoomSlider.value);
        zoomValue.textContent = zoomFactor.toFixed(2) + '×';
        // Redraw the grid at the new zoom factor.  drawHexGrid() will
        // allocate a larger internal canvas and scale the context accordingly.
        drawHexGrid();
    });

    // Canvas click: select a subsector based on mouse position and zoom
    canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        // Adjust for zoom factor to compute coordinates relative to unscaled canvas
        const x = (event.clientX - rect.left) / zoomFactor;
        const y = (event.clientY - rect.top) / zoomFactor;
        // Compute subsector width/height based on current side length
        const sqrt3local = Math.sqrt(3);
        const subW = (1.5 * subCols + 0.5) * currentSideLen;
        const subH = (subRows + 0.5) * sqrt3local * currentSideLen;
        const sx = Math.floor(x / subW);
        const sy = Math.floor(y / subH);
        if (sx >= 0 && sx < subSectorCols && sy >= 0 && sy < subSectorRows) {
            selectedSubsector = { sx, sy };
            downloadSubsectorBtn.style.display = 'inline-block';
        } else {
            selectedSubsector = null;
            downloadSubsectorBtn.style.display = 'none';
        }
        drawHexGrid();
    });

    // Simulation scale control: update the simulation scale factor and show the value.
    // Use input event to update display immediately and also update the encoded seed.
    simScaleSlider.addEventListener('input', () => {
        simulationScale = parseFloat(simScaleSlider.value);
        simScaleValue.textContent = simulationScale.toFixed(1);
        updateEncodedSeedString();
    });
    simScaleSlider.addEventListener('change', () => {
        // Regenerate the map with the new scale
        generateMap();
    });

    // Saturate slider: update saturateFactor and value display on input.
    // Also update the encoded seed to reflect the new saturate value.
    saturateSlider.addEventListener('input', () => {
        saturateFactor = parseFloat(saturateSlider.value);
        saturateValue.textContent = saturateFactor.toFixed(1);
        // Redraw the grid with new saturate factor (no need to re‑simulate)
        drawHexGrid();
        updateEncodedSeedString();
    });

    // Printable checkbox: toggle printableMode and redraw.  Update the
    // encoded seed prefix to reflect the new printable setting.
    printableCheckbox.addEventListener('change', () => {
        printableMode = printableCheckbox.checked;
        drawHexGrid();
        updateEncodedSeedString();
    });

    // Change display mode when radio buttons change.  Update the encoded seed
    // prefix to reflect the new mode and redraw the grid.
    modeRadioButtons.forEach((radio) => {
        radio.addEventListener('change', (event) => {
            displayMode = event.target.value;
            generateWholeWorlds = displayMode === 'density';
            // Redraw grid with new labels (no need to regenerate simulation)
            drawHexGrid();
            updateEncodedSeedString();
        });
    });

    // Presence threshold slider: update threshold and redraw grid
    presenceSlider.addEventListener('input', () => {
        presenceThresholdVal = parseInt(presenceSlider.value, 10);
        presenceValue.textContent = presenceSlider.value;
        drawHexGrid();
        updateEncodedSeedString();
    });

    // Map mode radio: switch between single and vastness sectors
    mapModeRadios.forEach((radio) => {
        radio.addEventListener('change', (event) => {
            applyMapMode(event.target.value, { regenerate: true });
            // Update presence slider max based on bit depth (unchanged) but clamp threshold
            presenceSlider.max = bitDepthSlider.value;
            if (presenceThresholdVal > parseInt(bitDepthSlider.value, 10)) {
                presenceThresholdVal = parseInt(bitDepthSlider.value, 10);
                presenceSlider.value = presenceThresholdVal;
                presenceValue.textContent = presenceThresholdVal.toString();
            }
            updateEncodedSeedString();
        });
    });

    /**
     * Export the entire sector to a high‑resolution PNG.  This draws the
     * entire grid into an off‑screen canvas at a resolution determined by
     * exportScale, then triggers a download.  PNG is used instead of JPEG to
     * preserve transparency around the hex tiles.
     */
    function exportSector() {
        const sqrt3local = Math.sqrt(3);
        // Target canvas dimensions scaled up by exportScale
        const exportMaxW = maxCanvasWidth * exportScale;
        const exportMaxH = maxCanvasHeight * exportScale;
        // Compute side length for export using the same formulas as
        // drawHexGrid but with scaled max dimensions
        const sideW = exportMaxW / (1.5 * cols + 0.5);
        const sideH = exportMaxH / ((rows + 0.5) * sqrt3local);
        const sideLenExp = Math.min(sideW, sideH);
        const hexHeightExp = sqrt3local * sideLenExp;
        const horizSpacingExp = 1.5 * sideLenExp;
        const verticalSpacingExp = hexHeightExp;
        const canvasW = (1.5 * cols + 0.5) * sideLenExp;
        const canvasH = (rows + 0.5) * hexHeightExp;
        // Create offscreen canvas
        const off = document.createElement('canvas');
        off.width = canvasW;
        off.height = canvasH;
        const offCtx = off.getContext('2d');
        // Determine levels and compute per-subsector min/max intensities
        const levels = parseInt(bitDepthSlider.value, 10);
        const subsectorRanges = computeSubsectorRanges();
        // Draw all hexes
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                const val = cellIntensities[index];
                const sx = Math.floor(col / subCols);
                const sy = Math.floor(row / subRows);
                const { minVal, maxVal } = subsectorRanges[sy * subSectorCols + sx];
                let norm = 0;
                if (maxVal > minVal) {
                    norm = (val - minVal) / (maxVal - minVal);
                }
                // Apply saturate factor
                if (saturateFactor !== 1) {
                    norm = Math.min(1, Math.max(0, Math.pow(norm, 1 / saturateFactor)));
                }
                let level = Math.floor(norm * (levels - 1));
                if (level < 0) level = 0;
                if (level >= levels) level = levels - 1;
                const gray = levels > 1 ? Math.floor((level / (levels - 1)) * 255) : 0;
                offCtx.fillStyle = `rgb(${gray},${gray},${gray})`;
                // Compute centre coordinates with odd‑q offset
                const offsetRows = (col % 2) * 0.5;
                const cx = col * horizSpacingExp + sideLenExp;
                const cy = (row + offsetRows) * verticalSpacingExp + hexHeightExp / 2;
                offCtx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const angleRad = (Math.PI / 180) * (60 * k);
                    const x = cx + sideLenExp * Math.cos(angleRad);
                    const y = cy + sideLenExp * Math.sin(angleRad);
                    if (k === 0) {
                        offCtx.moveTo(x, y);
                    } else {
                        offCtx.lineTo(x, y);
                    }
                }
                offCtx.closePath();
                if (!printableMode) {
                    // Solid fill in normal mode
                    offCtx.fillStyle = `rgb(${gray},${gray},${gray})`;
                    offCtx.fill();
                } else {
                    // Printable mode: do not fill or shade; leave hex
                    // background transparent.  Only the outline will be
                    // drawn (below) and DM values will be rendered.
                }
                // Draw a thin outline around each hex for legibility.  Use
                // a darker outline in printable mode.  This comes after
                // any fill or shading so it appears on top.
                {
                    const borderOpacityCell = printableMode ? 0.6 : 0.3;
                    offCtx.strokeStyle = `rgba(0, 0, 0, ${borderOpacityCell})`;
                    offCtx.lineWidth = 0.5 * exportScale;
                    offCtx.stroke();
                }
                // Determine text to display at centre based on displayMode
                let displayTextExp;
                if (displayMode === 'dm') {
                    const quartSize = levels / 4;
                    let region = Math.floor(level / quartSize);
                    if (region < 0) region = 0;
                    if (region > 3) region = 3;
                    const dmValue = -2 + region;
                    if (dmValue > 0) {
                        displayTextExp = `+${dmValue}`;
                    } else if (dmValue === 0) {
                        displayTextExp = '+0';
                    } else {
                        displayTextExp = dmValue.toString();
                    }
                } else {
                    // Presence mode for export: star if level meets threshold
                    const worldPresent = (level + 1) >= presenceThresholdVal;
                    displayTextExp = worldPresent ? '★' : '';
                }
                // Draw DM/star as primary text at centre
                const densityColour = printableMode ? '#000' : ((gray > 128) ? '#000' : '#fff');
                offCtx.fillStyle = densityColour;
                offCtx.textAlign = 'center';
                offCtx.textBaseline = 'middle';
                offCtx.font = `${(sideLenExp * 0.35).toFixed(2)}px sans-serif`;
                offCtx.fillText(displayTextExp, cx, cy);
                // Prepare secondary and tertiary text (UWP and codes) if whole-world generation is active
                let secondaryTextExp = '';
                let tertiaryTextExp = '';
                let tertiaryColourExp = null;
                // Determine world presence based on threshold
                const worldPresentExp = (level + 1) >= presenceThresholdVal;
                if (generateWholeWorlds && worldPresentExp) {
                    // Generate or retrieve world for this cell
                    if (!worlds[index]) {
                        worlds[index] = generateWorld();
                    }
                    const world = worlds[index];
                    // Compose UWP code (includes gas giant marker)
                    secondaryTextExp = worldToUWP(world);
                    // Compose trade and base codes
                    const codes = [];
                    if (world.tradeCodes && world.tradeCodes.length > 0) {
                        codes.push(...world.tradeCodes);
                    }
                    if (world.bases && world.bases.length > 0) {
                        codes.push(...world.bases);
                    }
                    if (codes.length > 0) {
                        tertiaryTextExp = codes.join(' ');
                        // Determine tertiary colour based on trade codes
                        const redCodes = ['In', 'Hi', 'Ht', 'Va', 'Ri'];
                        const amberCodes = ['Ag', 'As', 'Ba', 'De', 'Fl', 'Ic', 'Na', 'Ni', 'Lo', 'Lt', 'Po', 'Wa', 'Ga'];
                        if (world.tradeCodes && world.tradeCodes.some(tc => redCodes.includes(tc))) {
                            tertiaryColourExp = 'red';
                        } else if (world.tradeCodes && world.tradeCodes.some(tc => amberCodes.includes(tc))) {
                            tertiaryColourExp = 'orange';
                        }
                    }
                }
                // Draw secondary text (UWP code) if present
                if (secondaryTextExp) {
                    offCtx.font = `${(sideLenExp * 0.25).toFixed(2)}px monospace`;
                    offCtx.textBaseline = 'top';
                    // Position UWP code further down from centre
                    const secondaryYExp = cy + sideLenExp * 0.35;
                    offCtx.fillStyle = densityColour;
                    offCtx.fillText(secondaryTextExp, cx, secondaryYExp);
                }
                // Draw tertiary text (trade/base codes) if present
                if (tertiaryTextExp) {
                    // Use custom colour if defined, otherwise reuse densityColour
                    offCtx.fillStyle = tertiaryColourExp || densityColour;
                    offCtx.font = `${(sideLenExp * 0.20).toFixed(2)}px monospace`;
                    offCtx.textBaseline = 'top';
                    // Position tertiary text below secondary or moderate offset
                    const tertiaryYExp = secondaryTextExp ? cy + sideLenExp * 0.58 : cy + sideLenExp * 0.35;
                    offCtx.fillText(tertiaryTextExp, cx, tertiaryYExp);
                    // Reset fillStyle for subsequent drawing
                    offCtx.fillStyle = densityColour;
                }
                // Coordinate label
                // Use local coordinates within the subsector for labels
                const localCol = (col % subCols) + 1;
                const localRow = (row % subRows) + 1;
                const colStr = String(localCol).padStart(2, '0');
                const rowStr = String(localRow).padStart(2, '0');
                const coordLabel = `${colStr}${rowStr}`;
                offCtx.fillStyle = '#FF6600';
                offCtx.font = `${(sideLenExp * 0.25).toFixed(2)}px sans-serif`;
                const coordY = cy - sideLenExp * 0.6;
                offCtx.textBaseline = 'middle';
                offCtx.fillText(coordLabel, cx, coordY);
            }
        }
        // Draw subsector boundaries only when boundaries are enabled.  Highlight
        // hex edges at subsector borders to produce a zigzag boundary following the
        // hex geometry.
        if (showBoundaries) {
            offCtx.strokeStyle = '#0088CC';
            offCtx.lineWidth = 2 * exportScale;
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    // Compute centre of this hex
                    const offsetRows = (col % 2) * 0.5;
                    const cxBound = col * horizSpacingExp + sideLenExp;
                    const cyBound = (row + offsetRows) * verticalSpacingExp + hexHeightExp / 2;
                    // Compute vertices
                    const verts = [];
                    for (let k = 0; k < 6; k++) {
                        const angleRad = (Math.PI / 180) * (60 * k);
                        const vx = cxBound + sideLenExp * Math.cos(angleRad);
                        const vy = cyBound + sideLenExp * Math.sin(angleRad);
                        verts.push({ x: vx, y: vy });
                    }
                    // Vertical boundary: right edges where col+1 divisible by subCols, excluding sector's last column
                    if ((col + 1) % subCols === 0 && col !== cols - 1) {
                        offCtx.beginPath();
                        offCtx.moveTo(verts[0].x, verts[0].y);
                        offCtx.lineTo(verts[1].x, verts[1].y);
                        offCtx.stroke();
                        offCtx.beginPath();
                        offCtx.moveTo(verts[0].x, verts[0].y);
                        offCtx.lineTo(verts[5].x, verts[5].y);
                        offCtx.stroke();
                    }
                    // Horizontal boundary: bottom edges on the last row of each subsector
                    const isBoundaryRowExp = (((row + 1) % subRows) === 0) && (row < rows - 1);
                    if (isBoundaryRowExp) {
                        // Bottom horizontal (vertex 1→2)
                        offCtx.beginPath();
                        offCtx.moveTo(verts[1].x, verts[1].y);
                        offCtx.lineTo(verts[2].x, verts[2].y);
                        offCtx.stroke();
                        // Draw diagonals only on odd columns
                        if (col % 2 === 1) {
                            // Bottom‑left diagonal (vertex 3→2)
                            offCtx.beginPath();
                            offCtx.moveTo(verts[3].x, verts[3].y);
                            offCtx.lineTo(verts[2].x, verts[2].y);
                            offCtx.stroke();
                            // Bottom‑right diagonal (vertex 1→0)
                            offCtx.beginPath();
                            offCtx.moveTo(verts[1].x, verts[1].y);
                            offCtx.lineTo(verts[0].x, verts[0].y);
                            offCtx.stroke();
                        }
                    }
                }
            }
        }
        // Trigger download as PNG.  Use PNG format to preserve
        // transparency in areas outside of hex tiles.
        const dataURL = off.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = 'star_sector.png';
        link.click();
    }

    /**
     * Export a single subsector (sx, sy) to a high‑resolution PNG.  This
     * extracts the intensities for the 8×10 region, scales up by
     * exportScale and draws a new hex grid with local coordinates.  PNG
     * preserves transparency outside the hex tiles.
     */
    function exportSubsector(sx, sy) {
        const sqrt3local = Math.sqrt(3);
        // Determine base side length for a subsector; compute as though
        // drawing only an 8×10 grid within maxCanvasWidth/maxCanvasHeight.
        const subSideW = (maxCanvasWidth * exportScale) / (1.5 * subCols + 0.5);
        const subSideH = (maxCanvasHeight * exportScale) / ((subRows + 0.5) * sqrt3local);
        const sideLenExp = Math.min(subSideW, subSideH);
        const hexHeightExp = sqrt3local * sideLenExp;
        const horizSpacingExp = 1.5 * sideLenExp;
        const verticalSpacingExp = hexHeightExp;
        const canvasW = (1.5 * subCols + 0.5) * sideLenExp;
        const canvasH = (subRows + 0.5) * hexHeightExp;
        // Create offscreen canvas
        const off = document.createElement('canvas');
        off.width = canvasW;
        off.height = canvasH;
        const offCtx = off.getContext('2d');
        // Extract intensities for this subsector
        const subInts = new Array(subCols * subRows).fill(0);
        for (let r = 0; r < subRows; r++) {
            for (let c = 0; c < subCols; c++) {
                const globalRow = sy * subRows + r;
                const globalCol = sx * subCols + c;
                const globalIndex = globalRow * cols + globalCol;
                subInts[r * subCols + c] = cellIntensities[globalIndex];
            }
        }
        // Compute min/max for sub intensities
        let minVal = Infinity;
        let maxVal = -Infinity;
        for (const v of subInts) {
            if (v < minVal) minVal = v;
            if (v > maxVal) maxVal = v;
        }
        const levels = parseInt(bitDepthSlider.value, 10);
        // Draw the local hexes
        for (let row = 0; row < subRows; row++) {
            for (let col = 0; col < subCols; col++) {
                const idx = row * subCols + col;
                const val = subInts[idx];
                let norm = 0;
                if (maxVal > minVal) {
                    norm = (val - minVal) / (maxVal - minVal);
                }
                if (saturateFactor !== 1) {
                    norm = Math.min(1, Math.max(0, Math.pow(norm, 1 / saturateFactor)));
                }
                let level = Math.floor(norm * (levels - 1));
                if (level < 0) level = 0;
                if (level >= levels) level = levels - 1;
                const gray = levels > 1 ? Math.floor((level / (levels - 1)) * 255) : 0;
                offCtx.fillStyle = `rgb(${gray},${gray},${gray})`;
                // local odd‑q offset
                const offsetRows = (col % 2) * 0.5;
                const cx = col * horizSpacingExp + sideLenExp;
                const cy = (row + offsetRows) * verticalSpacingExp + hexHeightExp / 2;
                offCtx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const angleRad = (Math.PI / 180) * (60 * k);
                    const x = cx + sideLenExp * Math.cos(angleRad);
                    const y = cy + sideLenExp * Math.sin(angleRad);
                    if (k === 0) offCtx.moveTo(x, y);
                    else offCtx.lineTo(x, y);
                }
                offCtx.closePath();
                if (!printableMode) {
                    offCtx.fillStyle = `rgb(${gray},${gray},${gray})`;
                    offCtx.fill();
                } else {
                    // Printable mode: do not fill or shade; leave cell
                    // background transparent.  The border will be drawn
                    // below.
                }
                // Determine primary label (DM or star)
                let displayTextExp;
                const quartSizeSub = levels / 4;
                if (displayMode === 'dm') {
                    let region = Math.floor(level / quartSizeSub);
                    if (region < 0) region = 0;
                    if (region > 3) region = 3;
                    const dmValue = -2 + region;
                    if (dmValue > 0) displayTextExp = `+${dmValue}`;
                    else if (dmValue === 0) displayTextExp = '+0';
                    else displayTextExp = dmValue.toString();
                } else {
                    const worldPresent = (level + 1) >= presenceThresholdVal;
                    displayTextExp = worldPresent ? '★' : '';
                }
                const densityColour = printableMode ? '#000' : ((gray > 128) ? '#000' : '#fff');
                offCtx.fillStyle = densityColour;
                offCtx.font = `${(sideLenExp * 0.35).toFixed(2)}px sans-serif`;
                offCtx.textAlign = 'center';
                offCtx.textBaseline = 'middle';
                offCtx.fillText(displayTextExp, cx, cy);
                // Prepare secondary (UWP) and tertiary (trade/base) text if whole-world mode is active
                let secondaryTextExp = '';
                let tertiaryTextExp = '';
                let tertiaryColourExp = null;
                const worldPresentExp = (level + 1) >= presenceThresholdVal;
                if (generateWholeWorlds && worldPresentExp) {
                    // Compute global index to look up world in worlds[]
                    const globalRow = sy * subRows + row;
                    const globalCol = sx * subCols + col;
                    const globalIndex = globalRow * cols + globalCol;
                    if (!worlds[globalIndex]) {
                        worlds[globalIndex] = generateWorld();
                    }
                    const world = worlds[globalIndex];
                    secondaryTextExp = worldToUWP(world);
                    const codes = [];
                    if (world.tradeCodes && world.tradeCodes.length > 0) {
                        codes.push(...world.tradeCodes);
                    }
                    if (world.bases && world.bases.length > 0) {
                        codes.push(...world.bases);
                    }
                    if (codes.length > 0) {
                        tertiaryTextExp = codes.join(' ');
                        // Determine colour for tertiary text
                        const redCodes = ['In', 'Hi', 'Ht', 'Va', 'Ri'];
                        const amberCodes = ['Ag', 'As', 'Ba', 'De', 'Fl', 'Ic', 'Na', 'Ni', 'Lo', 'Lt', 'Po', 'Wa', 'Ga'];
                        if (world.tradeCodes && world.tradeCodes.some(tc => redCodes.includes(tc))) {
                            tertiaryColourExp = 'red';
                        } else if (world.tradeCodes && world.tradeCodes.some(tc => amberCodes.includes(tc))) {
                            tertiaryColourExp = 'orange';
                        }
                    }
                }
                // Draw secondary text (UWP code)
                if (secondaryTextExp) {
                    offCtx.font = `${(sideLenExp * 0.25).toFixed(2)}px monospace`;
                    offCtx.textBaseline = 'top';
                    const secondaryYExp = cy + sideLenExp * 0.35;
                    offCtx.fillStyle = densityColour;
                    offCtx.fillText(secondaryTextExp, cx, secondaryYExp);
                }
                // Draw tertiary text (trade/base codes)
                if (tertiaryTextExp) {
                    offCtx.fillStyle = tertiaryColourExp || densityColour;
                    offCtx.font = `${(sideLenExp * 0.20).toFixed(2)}px monospace`;
                    offCtx.textBaseline = 'top';
                    const tertiaryYExp = secondaryTextExp ? cy + sideLenExp * 0.58 : cy + sideLenExp * 0.35;
                    offCtx.fillText(tertiaryTextExp, cx, tertiaryYExp);
                    // Reset fillStyle for coordinate labels
                    offCtx.fillStyle = densityColour;
                }
                // Draw a thin outline around each hex for legibility.
                {
                    const borderOpacityCell = printableMode ? 0.6 : 0.3;
                    offCtx.strokeStyle = `rgba(0, 0, 0, ${borderOpacityCell})`;
                    offCtx.lineWidth = 0.5 * exportScale;
                    offCtx.stroke();
                }
                // coordinate label (local coordinates 01–08, 01–10)
                const colStr = String(col + 1).padStart(2, '0');
                const rowStr = String(row + 1).padStart(2, '0');
                const coordLabel = `${colStr}${rowStr}`;
                offCtx.fillStyle = '#FF6600';
                offCtx.font = `${(sideLenExp * 0.25).toFixed(2)}px sans-serif`;
                const coordY = cy - sideLenExp * 0.6;
                offCtx.fillText(coordLabel, cx, coordY);
            }
        }
        // Draw border around the subsector only if boundaries are enabled
        if (showBoundaries) {
            offCtx.strokeStyle = '#0088CC';
            offCtx.lineWidth = 2 * exportScale;
            offCtx.strokeRect(0, 0, canvasW, canvasH);
        }
        // Trigger download as PNG for transparency
        const dataURL = off.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `subsector_${sx + 1}${sy + 1}.png`;
        link.click();
    }
});
