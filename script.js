/*
 * Star Density Heat Map Generator
 *
 * This script implements a simplified slime‑mold (Physarum) simulation to
 * generate a density field over an 8 × 10 grid.  Agents move in a discrete
 * pixel space, sense a trail ahead, turn towards higher values, deposit
 * trail and the trail diffuses and decays.  After the simulation, the
 * accumulated trail is mapped onto a hexagonal grid and quantized to
 * produce dark and light tiles.  Users can regenerate the map, adjust
 * quantization bit depth and export the canvas as a JPEG.
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('heatmapCanvas');
    const ctx = canvas.getContext('2d');
    const bitDepthSlider = document.getElementById('bitDepth');
    const bitDepthValue = document.getElementById('bitDepthValue');
    const generateBtn = document.getElementById('generate');
    const downloadBtn = document.getElementById('download');
    const downloadSubsectorBtn = document.getElementById('downloadSubsector');
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

    // Hex grid configuration
    // Each subsector contains a fixed number of columns and rows of hexes
    const subCols = 8;    // columns per subsector (west–east)
    const subRows = 10;   // rows per subsector (north–south)
    // A sector is comprised of multiple subsectors.  Adjust these values to
    // control how many subsectors appear horizontally and vertically.
    const subSectorCols = 4; // number of subsectors across
    const subSectorRows = 4; // number of subsectors down
    // Total number of columns and rows in the entire sector
    const cols = subCols * subSectorCols;
    const rows = subRows * subSectorRows;
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
    let zoomFactor = 1.0;
    // Currently selected subsector for highlighting and export; null when none
    let selectedSubsector = null;
    // Export scale: how many times larger the exported JPEG should be compared
    // with the on‑screen canvas.  Increase this for higher resolution output.
    const exportScale = 3;
    // Store the side length computed in drawHexGrid for click detection and
    // export calculations
    let currentSideLen = 0;
    // Simulation scale factor controlling agent sensor distance and step size
    let simulationScale = 1.0;
    // Display mode: 'density' shows 1..n levels; 'dm' shows world occurrence DM values
    let displayMode = 'dm';
    // Saturate factor: controls brightness bias.  >1 brightens, <1 darkens.
    let saturateFactor = 1.0;

    // Seeded random number generator state.  To reproduce patterns, we use a
    // simple linear congruential generator (LCG) instead of Math.random()
    // during the simulation.  currentSeed holds the seed used for the
    // current map.  rngState stores the internal state of the LCG.
    let currentSeed = 0;
    let rngState = 0;

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

    /**
     * Run the slime‑mold simulation on a small 2D grid.  Returns a flat array
     * of length simWidth × simHeight representing the amount of trail at each
     * cell after diffusion and decay.  Uses a simplified version of the
     * agent‑based Physarum algorithm described by Pavel Peřina: each agent
     * senses the pheromone field straight ahead and slightly to the left and
     * right, turns toward the strongest signal, moves forward, deposits
     * trail, and the trail diffuses and decays.
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
        // Find min and max of intensities
        const minVal = Math.min(...cellIntensities);
        const maxVal = Math.max(...cellIntensities);
        // Clear canvas (in unscaled coordinate system)
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        // Loop through every cell to draw the hex, fill colour, labels
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                const val = cellIntensities[index];
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
                ctx.fill();
                // Optional thin border around each hex for legibility.  Omit
                // outlines when there are very few levels to avoid adding
                // perceptual greys.  Draw subtle outlines otherwise.
                if (levels > 3) {
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
                // Determine the text to display at the centre of the hex.
                let displayText;
                if (displayMode === 'dm') {
                    // Map the quantised level into four bands corresponding
                    // to DM modifiers -2, -1, 0, +1.  Divide the level
                    // range into four equal regions, clamp to [0,3], then
                    // convert to a string.  Zero and positive values are
                    // prefixed with a plus sign per user request.
                    const quartSize = levels / 4;
                    let region = Math.floor(level / quartSize);
                    if (region < 0) region = 0;
                    if (region > 3) region = 3;
                    const dmValue = -2 + region;
                    if (dmValue > 0) {
                        displayText = `+${dmValue}`;
                    } else if (dmValue === 0) {
                        displayText = '+0';
                    } else {
                        displayText = dmValue.toString();
                    }
                } else {
                    // Show density level as 1‑indexed
                    displayText = (level + 1).toString();
                }
                // Use white text on dark backgrounds and black on light backgrounds
                const densityColour = (gray > 128) ? '#000' : '#fff';
                ctx.fillStyle = densityColour;
                ctx.font = `${(sideLen * 0.35).toFixed(2)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(displayText, cx, cy);
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
        ctx.strokeStyle = '#0088CC';
        const boundaryWidth = 2;
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

    // Update bit depth display and redraw when slider moves
    bitDepthSlider.addEventListener('input', () => {
        bitDepthValue.textContent = bitDepthSlider.value;
        drawHexGrid();
    });

    // Generate new map on button click.  If a seed is provided in the
    // seedInput field, use it; otherwise generate a new random seed.
    generateBtn.addEventListener('click', () => {
        // Determine seed
        const seedStr = seedInput.value.trim();
        if (seedStr === '') {
            // Generate a new random seed (32‑bit unsigned integer)
            currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
            seedInput.value = currentSeed.toString();
        } else {
            // Parse the provided seed; fallback to zero on NaN
            const parsed = parseInt(seedStr, 10);
            currentSeed = isNaN(parsed) ? 0 : (parsed >>> 0);
        }
        // Initialise seeded RNG and display the seed
        setSeed(currentSeed);
        // Display the seed so users can note it for later.  The seed is
        // shown separately from the input field to make it obvious.
        seedDisplay.textContent = `Seed ${currentSeed}`;
        // Disable button temporarily to prevent multiple runs
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating…';
        // Run simulation asynchronously to keep UI responsive
        setTimeout(() => {
            generateMap();
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate New Map';
        }, 10);
    });

    // Download canvas as JPEG
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
    // Generate the first map automatically when the page loads.  Use a
    // random seed and store it so users can reproduce the pattern later.
    currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    seedInput.value = currentSeed.toString();
    setSeed(currentSeed);
    // Display the seed used for the initial map
    seedDisplay.textContent = `Seed ${currentSeed}`;
    generateMap();

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
    // Use input event to update display immediately and change event to regenerate map
    simScaleSlider.addEventListener('input', () => {
        simulationScale = parseFloat(simScaleSlider.value);
        simScaleValue.textContent = simulationScale.toFixed(1);
    });
    simScaleSlider.addEventListener('change', () => {
        // Regenerate the map with the new scale
        generateMap();
    });

    // Saturate slider: update saturateFactor and value display on input.
    saturateSlider.addEventListener('input', () => {
        saturateFactor = parseFloat(saturateSlider.value);
        saturateValue.textContent = saturateFactor.toFixed(1);
        // Redraw the grid with new saturate factor (no need to re‑simulate)
        drawHexGrid();
    });

    // Change display mode when radio buttons change
    modeRadioButtons.forEach((radio) => {
        radio.addEventListener('change', (event) => {
            displayMode = event.target.value;
            // Redraw grid with new labels (no need to regenerate simulation)
            drawHexGrid();
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
        // Determine levels and compute min/max intensities
        const levels = parseInt(bitDepthSlider.value, 10);
        const minVal = Math.min(...cellIntensities);
        const maxVal = Math.max(...cellIntensities);
        // Draw all hexes
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                const val = cellIntensities[index];
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
                offCtx.fill();
                // Determine text to display at center based on displayMode
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
                    displayTextExp = (level + 1).toString();
                }
                const densityColour = (gray > 128) ? '#000' : '#fff';
                offCtx.fillStyle = densityColour;
                offCtx.font = `${(sideLenExp * 0.35).toFixed(2)}px sans-serif`;
                offCtx.textAlign = 'center';
                offCtx.textBaseline = 'middle';
                offCtx.fillText(displayTextExp, cx, cy);
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
                offCtx.fillText(coordLabel, cx, coordY);
            }
        }
        // Draw subsector boundaries on export by highlighting hex edges instead of
        // drawing straight lines.  The right edges of the last column in each
        // subsector and the bottom edges of the last row in each subsector
        // are drawn using the boundary colour.  This yields a zigzag
        // boundary that follows the hex geometry.
        offCtx.strokeStyle = '#0088CC';
        offCtx.lineWidth = 2 * exportScale;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Compute centre of this hex
                const offsetRows = (col % 2) * 0.5;
                const cx = col * horizSpacingExp + sideLenExp;
                const cy = (row + offsetRows) * verticalSpacingExp + hexHeightExp / 2;
                // Compute vertices
                const verts = [];
                for (let k = 0; k < 6; k++) {
                    const angleRad = (Math.PI / 180) * (60 * k);
                    const x = cx + sideLenExp * Math.cos(angleRad);
                    const y = cy + sideLenExp * Math.sin(angleRad);
                    verts.push({ x, y });
                }
                // Vertical boundary: right edges of cells where col+1 is
                // divisible by subCols, except the last col of the sector
                if ((col + 1) % subCols === 0 && col !== cols - 1) {
                    // Draw two segments: v0->v1 and v0->v5
                    offCtx.beginPath();
                    offCtx.moveTo(verts[0].x, verts[0].y);
                    offCtx.lineTo(verts[1].x, verts[1].y);
                    offCtx.stroke();
                    offCtx.beginPath();
                    offCtx.moveTo(verts[0].x, verts[0].y);
                    offCtx.lineTo(verts[5].x, verts[5].y);
                    offCtx.stroke();
                }
                // Horizontal boundary: draw bottom edges and diagonals
                // on the last row of each subsector.  See drawHexGrid()
                // for the rationale.  We draw the bottom horizontal
                // (vertex 1→2) on every boundary cell, and depending on
                // column parity, draw the connecting diagonal: odd
                // columns use vertex 3→2; even columns use
                // vertex 1→0.  Skip the very bottom row.
                const isBoundaryRowExp = (((row + 1) % subRows) === 0) && (row < rows - 1);
                if (isBoundaryRowExp) {
                    // Bottom horizontal
                    offCtx.beginPath();
                    offCtx.moveTo(verts[1].x, verts[1].y);
                    offCtx.lineTo(verts[2].x, verts[2].y);
                    offCtx.stroke();
                    // Diagonal connections: odd columns draw both
                    // bottom‑left and bottom‑right diagonals; even columns
                    // draw none (their neighbours provide the connection).
                    if (col % 2 === 1) {
                        // Bottom‑left diagonal (vertex 3 → 2)
                        offCtx.beginPath();
                        offCtx.moveTo(verts[3].x, verts[3].y);
                        offCtx.lineTo(verts[2].x, verts[2].y);
                        offCtx.stroke();
                        // Bottom‑right diagonal (vertex 1 → 0)
                        offCtx.beginPath();
                        offCtx.moveTo(verts[1].x, verts[1].y);
                        offCtx.lineTo(verts[0].x, verts[0].y);
                        offCtx.stroke();
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
                offCtx.fill();
                // Determine label based on display mode
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
                    displayTextExp = (level + 1).toString();
                }
                const densityColour = (gray > 128) ? '#000' : '#fff';
                offCtx.fillStyle = densityColour;
                offCtx.font = `${(sideLenExp * 0.35).toFixed(2)}px sans-serif`;
                offCtx.textAlign = 'center';
                offCtx.textBaseline = 'middle';
                offCtx.fillText(displayTextExp, cx, cy);
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
        // Draw border around the subsector
        offCtx.strokeStyle = '#0088CC';
        offCtx.lineWidth = 2 * exportScale;
        offCtx.strokeRect(0, 0, canvasW, canvasH);
        // Trigger download as PNG for transparency
        const dataURL = off.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `subsector_${sx + 1}${sy + 1}.png`;
        link.click();
    }
});