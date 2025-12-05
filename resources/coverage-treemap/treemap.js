/**
 * Squarified Treemap Algorithm
 * Based on the algorithm by Bruls, Huizing, and van Wijk (2000)
 * "Squarified Treemaps"
 */

/**
 * Calculate the worst aspect ratio for a row of rectangles.
 * worst(R, w) = max(max(w²r+/s², s²/(w²r-)))
 * where r+ is the maximum and r- is the minimum of R, and s is the sum of R.
 * 
 * This calculates the worst aspect ratio that would result from laying out
 * the row along side w. Lower values mean more square-like rectangles.
 *
 * @param {Array<number>} row - List of areas (weights) in the row
 * @param {number} w - Length of the side along which rectangles are laid out
 * @returns {number} Worst aspect ratio (lower is better, 1.0 is perfect square)
 */
function worst(row, w) {
    if (row.length === 0) {
        return Infinity;
    }

    const s = row.reduce((sum, r) => sum + r, 0);
    if (s === 0 || w <= 0) {
        return Infinity;
    }

    const rPlus = Math.max(...row);
    const rMinus = Math.min(...row);

    // Calculate worst aspect ratio using the formula from the paper
    // For horizontal layout: height = s/w, width varies by area
    // Aspect ratio = max(width/height, height/width) for each rectangle
    const term1 = (w * w * rPlus) / (s * s);  // max width / height
    const term2 = (s * s) / (w * w * rMinus); // height / min width

    return Math.max(term1, term2);
}

/**
 * Rectangle layout state during computation.
 */
class Rectangle {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.w = width;
        this.h = height;
        this.results = [];
    }

    /**
     * Get the length of the shortest side of the remaining subrectangle.
     */
    /**
     * Get the length of the shortest side of the remaining subrectangle.
     * This is the side along which we'll layout the next row.
     */
    shortestSide() {
        return Math.min(this.w, this.h);
    }
    
    /**
     * Check if the rectangle is too small to layout properly.
     * Returns true if either dimension is below minimum threshold.
     */
    isTooSmall() {
        return this.w < 1 || this.h < 1;
    }

    /**
     * Layout a row of children in the rectangle.
     * CRITICAL: This must use the same `w` that was used in worst() calculation.
     *
     * @param {Array} row - List of nodes to layout in this row
     * @param {number} w - The side length along which to layout (must be shortestSide())
     */
    layoutRow(row, w) {
        if (row.length === 0 || w <= 0) {
            return;
        }

        const s = row.reduce((sum, node) => sum + node.weight, 0);
        
        // Guard against zero sum or invalid dimensions
        if (s === 0 || this.w <= 0 || this.h <= 0) {
            return;
        }

        // Determine orientation: horizontal if width is the shortest side
        const horizontal = this.w <= this.h;
        
        // Minimum row thickness to avoid subpixel collapse
        // Lowered threshold to ensure all rows are laid out, even if very thin
        const minThickness = 0.1;
        const rowThickness = s / w;
        
        if (rowThickness < minThickness || !isFinite(rowThickness)) {
            return;
        }

        if (horizontal) {
            // Layout horizontally: row is laid along width (which equals w)
            // Row height = s / w
            // Allow a small tolerance for floating point precision
            if (rowThickness > this.h + 0.01) {
                return; // Row won't fit
            }
            
            let currentX = this.x;
            const totalRowWidth = w;
            const numNodes = row.length;
            
            // Calculate widths for all nodes first
            const nodeWidths = row.map(node => (node.weight / s) * w);
            
            // For 2 nodes, give them equal shares (50% each) to ensure both are visible
            // For more nodes, use proportional with minimums
            let finalWidths;
            if (numNodes === 2) {
                // Equal shares for 2 nodes
                finalWidths = [totalRowWidth / 2, totalRowWidth / 2];
            } else {
                // For more nodes, use proportional with minimums
                const minShare = totalRowWidth * (numNodes <= 4 ? 0.1 : 0.05);
                const proportionalWidths = nodeWidths.map(width => Math.max(width, minShare));
                const totalProportional = proportionalWidths.reduce((sum, w) => sum + w, 0);
                
                if (totalProportional > totalRowWidth) {
                    const scale = totalRowWidth / totalProportional;
                    finalWidths = proportionalWidths.map(w => w * scale);
                } else {
                    finalWidths = proportionalWidths;
                }
            }
            
            for (let i = 0; i < row.length; i++) {
                const node = row[i];
                const finalWidth = finalWidths[i];
                if (isFinite(finalWidth) && finalWidth > 0) {
                    this.results.push({
                        ...node,
                        x: currentX,
                        y: this.y,
                        w: finalWidth,
                        h: rowThickness,
                    });
                    currentX += finalWidth;
                }
            }

            // Update rectangle for next row: move down by row thickness
            this.y += rowThickness;
            this.h -= rowThickness;
        } else {
            // Layout vertically: row is laid along height (which equals w)
            // Row width = s / w
            // Allow a small tolerance for floating point precision
            if (rowThickness > this.w + 0.01) {
                return; // Row won't fit
            }
            
            let currentY = this.y;
            const totalRowHeight = w; // In vertical layout, w is the height dimension
            const numNodes = row.length;
            
            // Calculate heights for all nodes first
            const nodeHeights = row.map(node => (node.weight / s) * w);
            
            // For 2 nodes, give them equal shares (50% each) to ensure both are visible
            // For more nodes, use proportional with minimums
            let finalHeights;
            if (numNodes === 2) {
                // Equal shares for 2 nodes
                finalHeights = [totalRowHeight / 2, totalRowHeight / 2];
            } else {
                // For more nodes, use proportional with minimums
                const minShare = totalRowHeight * (numNodes <= 4 ? 0.1 : 0.05);
                const proportionalHeights = nodeHeights.map(height => Math.max(height, minShare));
                const totalProportional = proportionalHeights.reduce((sum, h) => sum + h, 0);
                
                if (totalProportional > totalRowHeight) {
                    const scale = totalRowHeight / totalProportional;
                    finalHeights = proportionalHeights.map(h => h * scale);
                } else {
                    finalHeights = proportionalHeights;
                }
            }

            for (let i = 0; i < row.length; i++) {
                const node = row[i];
                const finalHeight = finalHeights[i];
                if (isFinite(finalHeight) && finalHeight > 0) {
                    this.results.push({
                        ...node,
                        x: this.x,
                        y: currentY,
                        w: rowThickness,
                        h: finalHeight,
                    });
                    currentY += finalHeight;
                }
            }

            // Update rectangle for next row: move right by row thickness
            this.x += rowThickness;
            this.w -= rowThickness;
        }
    }
}

/**
 * Recursive squarified treemap algorithm.
 * procedure squarify(list of real children, list of real row, real w)
 *
 * @param {Array} children - Remaining children to layout (sorted by weight, descending)
 * @param {Array} row - Current row being built (list of node objects)
 * @param {Rectangle} rect - Current rectangle state
 */
function squarify(children, row, rect) {
    // Guard against invalid rectangle
    if (rect.isTooSmall() || rect.w <= 0 || rect.h <= 0) {
        return; // Can't layout in invalid rectangle
    }
    
    if (children.length === 0) {
        // Layout remaining row if any
        if (row.length > 0) {
            const w = rect.shortestSide();
            rect.layoutRow(row, w);
        }
        return;
    }

    const c = children[0];
    const tail = children.slice(1);

    // Extract weights for worst() function comparison
    const rowWeights = row.map(n => n.weight);
    const rowWithCWeights = [...rowWeights, c.weight];

    // CRITICAL: Use the shortest side - this is the side we'll layout along
    // This MUST match the orientation used in layoutRow()
    const w = rect.shortestSide();
    
    if (w <= 0) {
        return; // Can't layout anymore
    }
    
    // Calculate worst aspect ratios using the formula from the paper
    // Lower values mean better (more square-like) rectangles
    const worstCurrent = row.length === 0 ? Infinity : worst(rowWeights, w);
    const worstWithC = worst(rowWithCWeights, w);

    // If adding c improves (or doesn't worsen) the aspect ratio, add it to the row
    // We want to minimize aspect ratio, so lower is better
    if (worstCurrent >= worstWithC || row.length === 0) {
        // Add to current row: aspect ratio improves or stays same (or is first element)
        squarify(tail, [...row, c], rect);
    } else {
        // Layout current row and start new row
        // The aspect ratio would get worse if we add c, so finalize current row
        // CRITICAL: Pass the same `w` that was used in worst() calculation
        rect.layoutRow(row, w);
        // Continue with remaining children in the new remaining space
        // Note: rect has been updated by layoutRow, so we use the new dimensions
        squarify(children, [], rect);
    }
}

/**
 * Normalize weights to fit the container area.
 *
 * @param {Array} nodes - Nodes with weight property
 * @param {number} totalArea - Total area to fill
 * @returns {Array} Nodes with normalized weights
 */
function normalizeWeights(nodes, totalArea) {
    const totalWeight = nodes.reduce((sum, node) => sum + node.weight, 0);

    if (totalWeight === 0) {
        return nodes.map(node => ({ ...node, weight: 0 }));
    }

    const scale = totalArea / totalWeight;

    return nodes.map(node => ({
        ...node,
        weight: node.weight * scale,
    }));
}

/**
 * Generate treemap layout for nodes using the squarified algorithm.
 *
 * @param {Array} nodes - Array of nodes with weight property
 * @param {number} width - Container width
 * @param {number} height - Container height
 * @returns {Array} Layout rectangles with x, y, w, h properties
 */
function generateTreemap(nodes, width, height) {
    if (nodes.length === 0 || width <= 0 || height <= 0 || !isFinite(width) || !isFinite(height)) {
        return [];
    }

    const totalArea = width * height;
    const normalized = normalizeWeights(nodes, totalArea);

    // Filter out nodes with zero or invalid weights
    // Also filter out nodes that are too small (less than 0.1 pixel in area)
    const minArea = 0.1; // Minimum area in pixels (very small threshold)
    const validNodes = normalized.filter(node => 
        node.weight >= minArea && isFinite(node.weight)
    );
    
    if (validNodes.length === 0) {
        return [];
    }

    // Sort by weight (descending) as required by the squarified algorithm
    // This is critical - the algorithm assumes sorted input
    const sorted = [...validNodes].sort((a, b) => b.weight - a.weight);

    // Create rectangle state
    const rect = new Rectangle(0, 0, width, height);

    // Special case: if we have exactly 2 nodes, force them into the same row
    // This ensures both are visible regardless of aspect ratio calculations
    if (sorted.length === 2) {
        // Manual layout for 2 nodes to avoid thickness issues
        const totalWeight = sorted[0].weight + sorted[1].weight;
        const width1 = width * (sorted[0].weight / totalWeight);
        const width2 = width - width1;
        const height1 = height;
        const height2 = height;
        
        rect.results.push({
            ...sorted[0],
            x: 0,
            y: 0,
            w: width1,
            h: height1,
        });
        
        rect.results.push({
            ...sorted[1],
            x: width1,
            y: 0,
            w: width2,
            h: height2,
        });
    } else {
        // Run recursive squarified algorithm for 3+ nodes
        squarify(sorted, [], rect);
    }

    // Filter out any invalid results and ensure minimum dimensions
    // Use a very small threshold to ensure all nodes are rendered, even if very thin
    const minDimension = 0.1; // Minimum width or height in pixels (lowered to prevent filtering out thin rectangles)
    return rect.results.filter(r => 
        isFinite(r.x) && isFinite(r.y) && 
        isFinite(r.w) && isFinite(r.h) && 
        r.w >= minDimension && r.h >= minDimension
    );
}

