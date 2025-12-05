// Note: generateTreemap is defined in treemap.js which is loaded before this file

let currentData = null;
let currentView = 'namespaces'; // 'namespaces', 'files', or 'methods'
let currentNamespace = null;
let currentFile = null;
let highlightedTests = new Set();
let resizeHandler = null;
let maxDepth = 0;
let currentDepth = 0;
let isSliderChanging = false; // Flag to prevent navigation during slider changes
let maxAspectRatio = null; // null means no limit, otherwise it's the max aspect ratio allowed
let isUpdatingAspectRatioFromHash = false; // Flag to prevent event loop during hash navigation

function debounce(fn, delay = 150) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

function getSvgSize(svg) {
    const parent = svg.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    const width = svg.clientWidth || (parentRect ? parentRect.width : 0) || window.innerWidth || 800;

    // Fill available height below the header, with a sensible minimum
    const top = svg.getBoundingClientRect().top || (parentRect ? parentRect.top : 0) || 0;
    let availableHeight = window.innerHeight - top - 24; // leave a little padding
    if (!Number.isFinite(availableHeight) || availableHeight < 300) {
        availableHeight = 600;
    }

    // Apply explicit height so clientHeight matches future measurements
    svg.style.height = `${availableHeight}px`;
    svg.style.width = '100%';

    return {
        width,
        height: availableHeight,
    };
}

/**
 * Encode a path for use in URL hash.
 */
function encodeHash(path) {
    if (!path) return '';
    return encodeURIComponent(path);
}

/**
 * Decode a path from URL hash.
 */
function decodeHash(hash) {
    if (!hash || hash === '#') return null;
    try {
        return decodeURIComponent(hash.substring(1)); // Remove #
    } catch (e) {
        return null;
    }
}

/**
 * Find a namespace by its full name anywhere in the tree.
 */
function findNamespaceByName(name) {
    if (!currentData || !name) return null;
    const stack = [...(currentData.namespaces || [])];
    while (stack.length) {
        const ns = stack.pop();
        if (ns.name === name) {
            return ns;
        }
        if (ns.namespaces && ns.namespaces.length) {
            stack.push(...ns.namespaces);
        }
    }
    return null;
}

/**
 * Find the namespace that contains a given file.
 */
function findNamespaceForFile(fileName) {
    if (!currentData || !fileName) return null;
    const stack = [...(currentData.namespaces || [])];
    while (stack.length) {
        const ns = stack.pop();
        if (ns.files) {
            const file = ns.files.find(f => (f.fullPath || f.name) === fileName || f.name === fileName);
            if (file) {
                return ns.name;
            }
        }
        if (ns.namespaces && ns.namespaces.length) {
            stack.push(...ns.namespaces);
        }
    }
    return null;
}

/**
 * Parse hash into namespace, file, depth, and aspectRatio components.
 * Format: #namespace or #namespace/file.php or #namespace?depth=2&aspectRatio=50 or #namespace/file.php?depth=2&aspectRatio=50
 * The hash is already decoded, so we just split on '/' and '?'
 */
function parseHash(hash) {
    const decoded = decodeHash(hash);
    if (!decoded) return { namespace: null, file: null, depth: null, aspectRatio: null };
    
    // Split on '?' to separate path from query parameters
    const [pathPart, queryPart] = decoded.split('?');
    let depth = null;
    let aspectRatio = null;
    
    // Parse query parameters
    if (queryPart) {
        const params = new URLSearchParams(queryPart);
        
        // Parse depth from query string
        const depthParam = params.get('depth');
        if (depthParam !== null) {
            const parsedDepth = parseInt(depthParam, 10);
            if (!isNaN(parsedDepth) && parsedDepth >= 0) {
                depth = parsedDepth;
            }
        }
        
        // Parse aspectRatio from query string
        const aspectRatioParam = params.get('aspectRatio');
        if (aspectRatioParam !== null) {
            const parsedAspectRatio = parseInt(aspectRatioParam, 10);
            if (!isNaN(parsedAspectRatio) && parsedAspectRatio >= 1 && parsedAspectRatio <= 100) {
                aspectRatio = parsedAspectRatio;
            }
        }
    }
    
    const parts = pathPart.split('/');
    if (parts.length === 1) {
        return { namespace: parts[0] || null, file: null, depth, aspectRatio };
    } else if (parts.length >= 2) {
        // First part is always the top-level namespace
        // Everything after is either a nested namespace path or namespace/file
        return { namespace: parts[0], file: parts.slice(1).join('/'), depth, aspectRatio };
    }
    return { namespace: null, file: null, depth, aspectRatio };
}

/**
 * Update URL hash without triggering navigation.
 * @param {string|null} namespace - The namespace path
 * @param {string|null} file - The file name
 * @param {number|null} depth - The depth level (optional, uses currentDepth if not provided)
 * @param {number|null} aspectRatio - The aspect ratio slider position (optional, uses current slider value if not provided)
 */
function updateHash(namespace, file, depth = null, aspectRatio = null) {
    let hash = '';
    if (namespace) {
        if (file) {
            // Encode the full path consistently: namespace/file
            const fullPath = `${namespace}/${file}`;
            hash = encodeHash(fullPath);
        } else {
            hash = encodeHash(namespace);
        }
    }
    
    // Build query parameters
    const params = [];
    
    // Add depth to hash if it's set (use provided depth or currentDepth)
    const depthToUse = depth !== null ? depth : (currentDepth > 0 ? currentDepth : null);
    if (depthToUse !== null && depthToUse > 0) {
        params.push(`depth=${depthToUse}`);
    }
    
    // Add aspectRatio to hash if it's set (use provided aspectRatio or current slider value)
    const aspectRatioToUse = aspectRatio !== null ? aspectRatio : getAspectRatioSliderValue();
    if (aspectRatioToUse !== null && aspectRatioToUse < 100) {
        params.push(`aspectRatio=${aspectRatioToUse}`);
    }
    
    // Add query string if we have any parameters
    if (params.length > 0) {
        hash += `?${params.join('&')}`;
    }
    
    // Only update if hash actually changed to avoid unnecessary history entries
    const newHash = '#' + hash;
    if (window.location.hash !== newHash) {
        // Use replaceState to avoid adding history entry, but don't prevent hashchange
        // We want hashchange to fire for proper navigation
        history.replaceState(null, '', newHash);
    }
}

/**
 * Get the current aspect ratio slider value (1-100).
 * @returns {number|null} Slider position or null if slider doesn't exist
 */
function getAspectRatioSliderValue() {
    const aspectRatioSlider = document.getElementById('aspect-ratio-slider');
    if (aspectRatioSlider) {
        const value = parseInt(aspectRatioSlider.value, 10);
        return isNaN(value) ? null : value;
    }
    return null;
}

/**
 * Navigate based on current hash.
 */
function navigateFromHash() {
    if (!currentData) return;
    
    const hash = window.location.hash;
    const decoded = decodeHash(hash);
    
    let namespace;
    let file;
    let depth = null;
    
    // Parse hash to get namespace, file, depth, and aspectRatio
    const parsed = parseHash(hash);
    namespace = parsed.namespace;
    file = parsed.file;
    depth = parsed.depth;
    const aspectRatio = parsed.aspectRatio;
    
    // Set depth: use depth from hash if specified, otherwise reset to 0
    // (This ensures navigation to new locations starts at default depth)
    if (depth !== null) {
        currentDepth = depth;
    } else {
        currentDepth = 0;
    }
    
    // Set aspect ratio: use aspectRatio from hash if specified, otherwise use default (100 = no limit)
    isUpdatingAspectRatioFromHash = true; // Prevent event loop
    try {
        if (aspectRatio !== null) {
            // Update the slider and maxAspectRatio
            const aspectRatioSlider = document.getElementById('aspect-ratio-slider');
            const aspectRatioValue = document.getElementById('aspect-ratio-value');
            if (aspectRatioSlider && aspectRatioValue) {
                aspectRatioSlider.value = aspectRatio;
                
                if (aspectRatio >= 100) {
                    maxAspectRatio = null;
                    aspectRatioValue.textContent = 'No Limit';
                } else {
                    const aspectRatioValue_log = sliderToAspectRatio(aspectRatio);
                    maxAspectRatio = aspectRatioValue_log;
                    aspectRatioValue.textContent = aspectRatioValue_log >= 10 ? 
                        Math.round(aspectRatioValue_log).toString() : 
                        aspectRatioValue_log.toFixed(1);
                }
            }
        } else {
            // If no aspectRatio in URL, ensure slider is at default (100 = no limit)
            const aspectRatioSlider = document.getElementById('aspect-ratio-slider');
            const aspectRatioValue = document.getElementById('aspect-ratio-value');
            if (aspectRatioSlider && aspectRatioValue && aspectRatioSlider.value !== '100') {
                aspectRatioSlider.value = 100;
                maxAspectRatio = null;
                aspectRatioValue.textContent = 'No Limit';
            }
        }
    } finally {
        isUpdatingAspectRatioFromHash = false;
    }
    
    // Try exact namespace match first (handles nested namespaces like "Models/Ingredients")
    // But only if we didn't get a namespace from parsing (to handle query params)
    if (!namespace && decoded) {
        // Remove query params for exact match check
        const pathOnly = decoded.split('?')[0];
        const exactNamespace = findNamespaceByName(pathOnly);
        if (exactNamespace) {
            namespace = pathOnly;
            file = null;
        }
    }
    
    if (!namespace) {
        renderNamespaces();
        return;
    }
    
    // Find namespace
    const ns = findNamespaceByName(namespace);
    if (!ns) {
        renderNamespaces();
        return;
    }
    
    if (!file) {
        renderFiles(namespace, ns.files || []);
        return;
    }
    
    // The file might be a path like "Ingredients/Brand.php" (nested namespace + file)
    // or "Resources/Recipes/Pages/ReviewRecipes.php" (deeply nested namespace + file)
    // or just "Brand.php" (file in current namespace)
    // First, check if it's a nested namespace path with a file
    const fileParts = file.split('/');
    if (fileParts.length > 1) {
        // It's a path like "Ingredients/Brand.php" or "Resources/Recipes/Pages/ReviewRecipes.php"
        const fileName = fileParts[fileParts.length - 1]; // "Brand.php" or "ReviewRecipes.php"
        const nestedNamespaceParts = fileParts.slice(0, -1); // ["Ingredients"] or ["Resources", "Recipes", "Pages"]
        
        // Recursively navigate through nested namespaces
        let currentNs = ns;
        let currentNamespacePath = namespace;
        let foundNestedNamespace = true;
        
        for (const part of nestedNamespaceParts) {
            const nextNamespacePath = `${currentNamespacePath}/${part}`;
            if (currentNs.namespaces) {
                const nextNs = currentNs.namespaces.find(n => n.name === nextNamespacePath);
                if (nextNs) {
                    currentNs = nextNs;
                    currentNamespacePath = nextNamespacePath;
                } else {
                    foundNestedNamespace = false;
                    break;
                }
            } else {
                foundNestedNamespace = false;
                break;
            }
        }
        
        if (foundNestedNamespace && currentNs) {
            // Found the nested namespace, now find the file in it
            // fileName is "Brand.php" or "ReviewRecipes.php" (from the hash path)
            const fileObj = currentNs.files.find(f => {
                const fileNameMatch = f.name;
                const fileFullPath = f.fullPath || f.name;
                // Try exact match on name (e.g., "Brand.php" === "Brand.php")
                if (fileNameMatch === fileName) return true;
                // Try match on basename (in case fileName has path components)
                const fileNameBase = fileName.split('/').pop();
                if (fileNameMatch === fileNameBase) return true;
                // Try match on fullPath basename
                const fileFullPathBase = fileFullPath.split('/').pop();
                if (fileFullPathBase === fileName) return true;
                // Also try matching the basename of fileName against the basename of fileFullPath
                if (fileFullPathBase === fileNameBase) return true;
                return false;
            });
            
            if (fileObj) {
                // Found the file in the nested namespace
                currentNamespace = currentNamespacePath;
                const fullFileName = fileObj.fullPath || fileObj.name;
                const methods = fileObj.methods || [];
                // Always render methods view, even if empty (it will show appropriate message)
                renderMethods(fullFileName, methods);
                return;
            } else {
                // File not found in nested namespace, show files view for the nested namespace
                console.warn(`File ${fileName} not found in namespace ${currentNamespacePath}, showing files view`);
                currentNamespace = currentNamespacePath;
                renderFiles(currentNamespacePath, currentNs.files || []);
                return;
            }
        } else {
            // Nested namespace path not found, fall through to other checks
            console.warn(`Nested namespace path not found: ${namespace}/${nestedNamespaceParts.join('/')}`);
        }
    }
    
    // Check if "file" is actually a nested namespace within the parent (no file part)
    // e.g., "Ingredients" in "Models/Ingredients" is a nested namespace, not a file
    const fullNamespace = `${namespace}/${file}`;
    if (ns.namespaces) {
        const nestedNs = ns.namespaces.find(n => n.name === fullNamespace);
        if (nestedNs) {
            // It's a nested namespace, not a file - pass the files explicitly
            renderFiles(fullNamespace, nestedNs.files || []);
            return;
        }
    }
    
    // Also check if the full namespace exists at top level (shouldn't happen, but just in case)
    const fullNs = currentData.namespaces.find(n => n.name === fullNamespace);
    if (fullNs) {
        renderFiles(fullNamespace, fullNs.files || []);
        return;
    }
    
    // Find file in current namespace - try multiple matching strategies
    // The file from hash might be just the filename (e.g., "KrogerService.php")
    // or it might be a path. We need to match against both f.name and f.fullPath
    const fileObj = ns.files.find(f => {
        const fileName = f.name;
        const fileFullPath = f.fullPath || f.name;
        const hashFile = file; // e.g., "KrogerService.php" or "Services/KrogerService.php"
        
        // Try exact match on name
        if (fileName === hashFile) return true;
        // Try exact match on fullPath
        if (fileFullPath === hashFile) return true;
        // Try match on basename (most common case for hash navigation)
        if (fileName === hashFile.split('/').pop()) return true;
        // Try match on fullPath basename
        if (fileFullPath.split('/').pop() === hashFile) return true;
        // Try match on fullPath basename vs hashFile basename
        if (fileFullPath.split('/').pop() === hashFile.split('/').pop()) return true;
        return false;
    });
    
    if (!fileObj) {
        // File not found, show files view
        renderFiles(namespace, ns.files || []);
        return;
    }
    
    // CRITICAL: Set currentNamespace before calling renderMethods
    // so it has the correct context for breadcrumb rendering
    currentNamespace = namespace;
    
    // Use the file's actual fullPath or name for rendering
    const fileName = fileObj.fullPath || fileObj.name;
    
    // Even if methods array is empty, still render methods view
    // (it will show "No methods to display" message)
    renderMethods(fileName, fileObj.methods || []);
}

/**
 * Load and parse the coverage data.
 */
function loadData() {
    currentData = COVERAGE_DATA;
    initializeDepthControl();
    initializeAspectRatioControl();
    navigateFromHash();
}

/**
 * Get a label for a depth level.
 * @param {number} depth - The depth level (can be any number)
 * @param {string} view - The current view ('namespaces' or 'files') - unused, kept for compatibility
 * @returns {string} Simple numeric label for the depth
 */
function getDepthLabel(depth, view = 'namespaces') {
    return `Depth ${depth}`;
}

/**
 * Convert slider position (1-99) to logarithmic aspect ratio.
 * Slider 1 → aspect ratio 1, Slider 99 → aspect ratio 1000
 * Uses logarithmic scale: aspectRatio = 10^((sliderValue - 1) / 98 * 3)
 *
 * @param {number} sliderValue - Slider position (1-99)
 * @returns {number} Aspect ratio value
 */
function sliderToAspectRatio(sliderValue) {
    if (sliderValue <= 1) {
        return 1;
    }
    if (sliderValue >= 99) {
        return 1000;
    }
    // Logarithmic scale: 1 to 1000 (10^0 to 10^3)
    return Math.pow(10, ((sliderValue - 1) / 98) * 3);
}

/**
 * Convert aspect ratio to slider position (for display purposes).
 * Inverse of sliderToAspectRatio.
 *
 * @param {number} aspectRatio - Aspect ratio value
 * @returns {number} Slider position (1-99)
 */
function aspectRatioToSlider(aspectRatio) {
    if (aspectRatio <= 1) {
        return 1;
    }
    if (aspectRatio >= 1000) {
        return 99;
    }
    // Inverse of logarithmic scale
    return 1 + (Math.log10(aspectRatio) / 3) * 98;
}

/**
 * Initialize the aspect ratio control slider.
 */
function initializeAspectRatioControl() {
    const aspectRatioControl = document.getElementById('aspect-ratio-control');
    const aspectRatioSlider = document.getElementById('aspect-ratio-slider');
    const aspectRatioValue = document.getElementById('aspect-ratio-value');
    
    if (aspectRatioControl && aspectRatioSlider && aspectRatioValue) {
        // Set initial value (100 = no limit)
        aspectRatioSlider.setAttribute('value', 100);
        maxAspectRatio = null; // null means no limit
        aspectRatioValue.textContent = 'No Limit';
        
        // Add event listener for slider changes
        aspectRatioSlider.addEventListener('input', (e) => {
            // Skip if we're updating from hash to avoid event loop
            if (isUpdatingAspectRatioFromHash) {
                return;
            }
            
            const sliderValue = parseInt(e.target.value, 10);
            if (sliderValue >= 100) {
                maxAspectRatio = null; // No limit
                aspectRatioValue.textContent = 'No Limit';
            } else {
                // Convert slider position to logarithmic aspect ratio
                const aspectRatio = sliderToAspectRatio(sliderValue);
                maxAspectRatio = aspectRatio;
                // Display with 1 decimal place for precision
                aspectRatioValue.textContent = aspectRatio >= 10 ? 
                    Math.round(aspectRatio).toString() : 
                    aspectRatio.toFixed(1);
            }
            
            // Update hash with new aspect ratio (but don't trigger navigation)
            updateHash(null, null, null, sliderValue);
            
            // Re-render current view with new aspect ratio limit
            rerenderCurrentView();
        });
    }
}

/**
 * Initialize the depth control slider.
 */
function initializeDepthControl() {
    if (!currentData || !currentData.namespaces) {
        return;
    }
    
    // Calculate maximum depth
    maxDepth = calculateMaxDepth(currentData.namespaces);
    console.log('maxDepth', maxDepth);
    console.log('currentData.namespaces', currentData.namespaces);
    
    // Set up slider
    const depthControl = document.getElementById('depth-control');
    const depthSlider = document.getElementById('depth-slider');
    const depthValue = document.getElementById('depth-value');
    
    if (depthControl && depthSlider && depthValue) {
        // Only show slider if there's content that can be shown at different depths
        if (maxDepth > 0) {
            depthControl.style.display = 'block';
            depthSlider.setAttribute('max', maxDepth);
            depthSlider.setAttribute('value', currentDepth);
            depthValue.textContent = getDepthLabel(currentDepth, currentView);
            
            // Add event listener for slider changes
            depthSlider.addEventListener('input', (e) => {
                isSliderChanging = true;
                currentDepth = parseInt(e.target.value, 10);
                depthValue.textContent = getDepthLabel(currentDepth, currentView);
                
                // Re-render if we're on the namespaces view (skip hash update to prevent navigation)
                if (currentView === 'namespaces') {
                    renderNamespaces(true);
                }
                
                // Reset flag after a short delay to allow any pending events to complete
                setTimeout(() => {
                    isSliderChanging = false;
                }, 100);
            });
        } else {
            depthControl.style.display = 'none';
        }
    }
}

/**
 * Calculate the maximum namespace nesting depth (how many levels deep namespaces go).
 * This counts the actual nesting levels, not including files/methods.
 * @param {Object} namespace - The namespace to check
 * @param {number} currentLevel - Current nesting level (starts at 0 for the namespace itself)
 * @returns {number} Maximum nesting depth found (0 = no nesting, 1 = 1 level deep, etc.)
 */
function calculateMaxNamespaceDepth(namespace, currentLevel = 0) {
    if (!namespace) {
        return currentLevel;
    }
    
    let maxDepth = currentLevel;
    
    // Recursively check nested namespaces
    if (namespace.namespaces && namespace.namespaces.length > 0) {
        for (const nestedNs of namespace.namespaces) {
            const nestedDepth = calculateMaxNamespaceDepth(nestedNs, currentLevel + 1);
            maxDepth = Math.max(maxDepth, nestedDepth);
        }
    }
    
    return maxDepth;
}

/**
 * Check if any files have methods in a namespace tree.
 * @param {Object} namespace - The namespace to check
 * @returns {boolean} True if any file has methods
 */
function hasMethodsInNamespace(namespace) {
    if (!namespace) {
        return false;
    }
    
    // Check files in this namespace
    if (namespace.files && namespace.files.length > 0) {
        for (const file of namespace.files) {
            if (file.methods && file.methods.length > 0) {
                return true;
            }
        }
    }
    
    // Check nested namespaces
    if (namespace.namespaces && namespace.namespaces.length > 0) {
        for (const nestedNs of namespace.namespaces) {
            if (hasMethodsInNamespace(nestedNs)) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Check if any namespace has files in the tree.
 * @param {Object} namespace - The namespace to check
 * @returns {boolean} True if any namespace has files
 */
function hasFilesInNamespace(namespace) {
    if (!namespace) {
        return false;
    }
    
    // Check files in this namespace
    if (namespace.files && namespace.files.length > 0) {
        return true;
    }
    
    // Check nested namespaces
    if (namespace.namespaces && namespace.namespaces.length > 0) {
        for (const nestedNs of namespace.namespaces) {
            if (hasFilesInNamespace(nestedNs)) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Calculate the maximum nesting depth for a single namespace.
 * The depth system works as follows:
 * - 0: Current namespace only (flat list)
 * - 1 to N: Show N levels of nested namespaces (where N is the max namespace nesting depth)
 * - N+1: Show files (if files exist)
 * - N+2: Show methods (if methods exist)
 * 
 * Returns the maximum depth level that should be available in the slider.
 */
function calculateMaxDepthForNamespace(namespace) {
    if (!namespace) {
        return 0;
    }
    
    // Calculate the actual maximum namespace nesting depth
    // This tells us how many levels deep the namespace tree goes
    const maxNamespaceDepth = calculateMaxNamespaceDepth(namespace, 0);
    
    // Start with the namespace depth
    let maxDepthLevel = maxNamespaceDepth;
    
    // If we have any nested namespaces, we need at least depth 1 to show them
    if (maxNamespaceDepth > 0) {
        maxDepthLevel = maxNamespaceDepth;
    }
    
    // Check if we have files anywhere in the tree
    const hasFiles = hasFilesInNamespace(namespace);
    if (hasFiles) {
        // Files are shown at maxNamespaceDepth + 1
        maxDepthLevel = Math.max(maxDepthLevel, maxNamespaceDepth + 1);
    }
    
    // Check if we have methods anywhere in the tree
    const hasMethods = hasMethodsInNamespace(namespace);
    if (hasMethods) {
        // Methods are shown at maxNamespaceDepth + 2
        maxDepthLevel = Math.max(maxDepthLevel, maxNamespaceDepth + 2);
    }
    
    return maxDepthLevel;
}

/**
 * Calculate the maximum nesting depth in the namespace tree.
 * Depth levels:
 * - 0: Top-level namespaces only
 * - 1: Namespaces + nested namespaces (hierarchical)
 * - 2: Namespaces + nested namespaces + files (hierarchical)
 * - 3: Namespaces + nested namespaces + files + methods (hierarchical)
 * 
 * Returns the maximum depth level that should be available in the slider.
 */
function calculateMaxDepth(namespaces) {
    if (!namespaces || namespaces.length === 0) {
        return 0; // No content, so max depth is 0
    }
    
    let maxDepthLevel = 0; // Track the maximum depth level needed
    
    for (const ns of namespaces) {
        const nsDepth = calculateMaxDepthForNamespace(ns);
        maxDepthLevel = Math.max(maxDepthLevel, nsDepth);
    }
    
    return maxDepthLevel;
}

/**
 * Build hierarchical namespace structure for depth-aware rendering.
 * Depth levels:
 * - 0: Top-level namespaces only
 * - 1: Namespaces + nested namespaces (hierarchical)
 * - 2: Namespaces + nested namespaces + files (hierarchical)
 * - 3: Namespaces + nested namespaces + files + methods (hierarchical)
 * @param {Array} namespaces - Array of namespace objects
 * @param {number} maxDepth - Maximum depth to show (0 = top level only)
 * @param {number} currentDepth - Current depth in recursion
 * @returns {Array} Array of nodes with nested children
 */
function buildHierarchicalNamespaces(namespaces, maxDepth, currentDepth = 0) {
    if (!namespaces || namespaces.length === 0) {
        return [];
    }
    
    const nodes = [];
    
    for (const ns of namespaces) {
        const node = {
            id: ns.name,
            name: ns.name || 'Root',
            fullName: ns.name,
            weight: ns.coverable,
            coverable: ns.coverable,
            covered: ns.covered,
            percent: coveragePercent(ns.covered, ns.coverable),
            files: ns.files,
            namespaces: ns.namespaces || [],
            depth: currentDepth,
            children: null,
            type: 'namespace',
        };
        
        const children = [];
        
        // Include nested namespaces if they exist and we haven't reached maxDepth yet
        if (currentDepth < maxDepth && ns.namespaces && ns.namespaces.length > 0) {
            const nestedNamespaces = buildHierarchicalNamespaces(ns.namespaces, maxDepth, currentDepth + 1);
            children.push(...nestedNamespaces);
        }
        
        // Include files when there's remaining depth to show another level
        // (i.e., when currentDepth < maxDepth)
        if (currentDepth < maxDepth && ns.files && ns.files.length > 0) {
            for (const file of ns.files) {
                const fileNode = {
                    id: file.fullPath || file.name,
                    name: file.name,
                    fullName: file.fullPath || file.name,
                    weight: file.coverable > 0 ? file.coverable : 0.5,
                    coverable: file.coverable,
                    covered: file.covered,
                    percent: coveragePercent(file.covered, file.coverable),
                    methods: file.methods || [],
                    depth: currentDepth + 1,
                    children: null,
                    type: 'file',
                };
                
                // Include methods only when depth allows going one level deeper past files
                if (file.methods && file.methods.length > 0 && (currentDepth + 1) < maxDepth) {
                    fileNode.children = file.methods.map(method => ({
                        id: method.name,
                        name: method.name.split('::').pop(),
                        fullName: method.name,
                        weight: method.coverable > 0 ? method.coverable : 0.5,
                        coverable: method.coverable,
                        covered: method.covered,
                        percent: coveragePercent(method.covered, method.coverable),
                        tests: method.tests || [],
                        depth: currentDepth + 2,
                        children: null,
                        type: 'method',
                    }));
                }
                
                children.push(fileNode);
            }
        }
        
        if (children.length > 0) {
            node.children = children;
        }
        
        nodes.push(node);
    }
    
    return nodes;
}

/**
 * Build hierarchical structure for a namespace's content (files + nested namespaces).
 * This is used when viewing a specific namespace (e.g., #Filament).
 * Depth levels:
 * - 0: Files and nested namespaces shown as flat list
 * - 1: Files shown (flat) + nested namespaces shown hierarchically (if they exist)
 * - 2: Files shown hierarchically + nested namespaces shown hierarchically
 * - 3: Files with methods shown hierarchically + nested namespaces shown hierarchically
 * @param {Object} namespace - The namespace object
 * @param {number} maxDepth - Maximum depth to show
 * @param {number} currentDepth - Current depth in recursion (starts at 0)
 * @returns {Array} Array of nodes with nested children
 */
function buildHierarchicalNamespaceContent(namespace, maxDepth, currentDepth = 0) {
    if (!namespace) {
        return [];
    }
    
    const nodes = [];
    
    // Add nested namespaces
    if (namespace.namespaces && namespace.namespaces.length > 0) {
        for (const ns of namespace.namespaces) {
            const node = {
                id: ns.name,
                name: ns.name.split('/').pop(), // Just the last part
                fullName: ns.name,
                weight: ns.coverable,
                coverable: ns.coverable,
                covered: ns.covered,
                percent: coveragePercent(ns.covered, ns.coverable),
                files: ns.files,
                namespaces: ns.namespaces || [],
                depth: currentDepth,
                children: null,
                type: 'namespace',
            };
            
            const children = [];
            
            // Include nested namespaces if they exist and we haven't reached maxDepth yet
            if (currentDepth < maxDepth && ns.namespaces && ns.namespaces.length > 0) {
                const nestedContent = buildHierarchicalNamespaceContent(ns, maxDepth, currentDepth + 1);
                children.push(...nestedContent.filter(n => n.type === 'namespace'));
            }
            
            // Include files when there's remaining depth to show another level
            if (currentDepth < maxDepth && ns.files && ns.files.length > 0) {
                for (const file of ns.files) {
                    const fileNode = {
                        id: file.fullPath || file.name,
                        name: file.name,
                        fullName: file.fullPath || file.name,
                        weight: file.coverable > 0 ? file.coverable : 0.5,
                        coverable: file.coverable,
                        covered: file.covered,
                        percent: coveragePercent(file.covered, file.coverable),
                        methods: file.methods || [],
                        depth: currentDepth + 1,
                        children: null,
                        type: 'file',
                    };
                    
                    // Include methods only when depth allows going one level deeper past files
                    if (file.methods && file.methods.length > 0 && (currentDepth + 1) < maxDepth) {
                        fileNode.children = file.methods.map(method => ({
                            id: method.name,
                            name: method.name.split('::').pop(),
                            fullName: method.name,
                            weight: method.coverable > 0 ? method.coverable : 0.5,
                            coverable: method.coverable,
                            covered: method.covered,
                            percent: coveragePercent(method.covered, method.coverable),
                            tests: method.tests || [],
                            depth: currentDepth + 2,
                            children: null,
                            type: 'method',
                        }));
                    }
                    
                    children.push(fileNode);
                }
            }
            
            if (children.length > 0) {
                node.children = children;
            }
            
            nodes.push(node);
        }
    }
    
    // Add files from the current namespace if they exist and depth allows (files are one level deeper)
    if (currentDepth < maxDepth && namespace.files && namespace.files.length > 0) {
        for (const file of namespace.files) {
            const fileNode = {
                id: file.fullPath || file.name,
                name: file.name,
                fullName: file.fullPath || file.name,
                weight: file.coverable > 0 ? file.coverable : 0.5,
                coverable: file.coverable,
                covered: file.covered,
                percent: coveragePercent(file.covered, file.coverable),
                methods: file.methods || [],
                depth: currentDepth,
                children: null,
                type: 'file',
            };
            
            // Include methods only when depth allows going one level deeper past files
            if (file.methods && file.methods.length > 0 && (currentDepth + 1) < maxDepth) {
                fileNode.children = file.methods.map(method => ({
                    id: method.name,
                    name: method.name.split('::').pop(),
                    fullName: method.name,
                    weight: method.coverable > 0 ? method.coverable : 0.5,
                    coverable: method.coverable,
                    covered: method.covered,
                    percent: coveragePercent(method.covered, method.coverable),
                    tests: method.tests || [],
                    depth: currentDepth + 1,
                    children: null,
                    type: 'method',
                }));
            }
            
            nodes.push(fileNode);
        }
    }
    
    return nodes;
}

/**
 * Calculate coverage percentage.
 */
function coveragePercent(covered, coverable) {
    if (coverable === 0) {
        return 0; // 0/0 should show 0%, not 100%
    }
    return Math.round((covered / coverable) * 100);
}

/**
 * Get color for coverage percentage.
 */
function getCoverageColor(percent) {
    if (percent >= 80) {
        return '#22c55e'; // green
    }
    if (percent >= 50) {
        return '#eab308'; // yellow
    }
    return '#ef4444'; // red
}

/**
 * Render namespace-level treemap.
 * @param {boolean} skipHashUpdate - If true, don't update the hash (useful for slider changes)
 */
function renderNamespaces(skipHashUpdate = false) {
    currentView = 'namespaces';
    currentNamespace = null;
    currentFile = null;

    // Show depth slider when viewing namespaces (if max depth > 0)
    const depthControl = document.getElementById('depth-control');
    const depthSlider = document.getElementById('depth-slider');
    const depthValue = document.getElementById('depth-value');
    if (depthControl && depthSlider && depthValue && maxDepth > 0) {
        depthControl.style.display = 'block';
        depthSlider.setAttribute('max', maxDepth);
        depthSlider.setAttribute('value', currentDepth);
        // Update depth label when switching to namespaces view
        depthValue.textContent = getDepthLabel(currentDepth, 'namespaces');
        
        // Only replace slider if not currently being dragged (to preserve mouse capture)
        if (!isSliderChanging) {
            // Remove existing event listeners by cloning (clean way to remove all listeners)
            const newSlider = depthSlider.cloneNode(true);
            depthSlider.parentNode.replaceChild(newSlider, depthSlider);
            
            // Add event listener for namespaces view
            newSlider.addEventListener('input', (e) => {
                isSliderChanging = true;
                currentDepth = parseInt(e.target.value, 10);
                const depthValueEl = document.getElementById('depth-value');
                if (depthValueEl) {
                    depthValueEl.textContent = getDepthLabel(currentDepth, 'namespaces');
                }
                // Update hash with new depth (but don't trigger navigation)
                updateHash(null, null, currentDepth);
                // Re-render namespaces view with new depth (skip hash update to prevent navigation)
                renderNamespaces(true);
                
                // Reset flag after a short delay to allow any pending events to complete
                setTimeout(() => {
                    isSliderChanging = false;
                }, 100);
            });
        }
    } else if (depthControl && maxDepth > 0) {
        depthControl.style.display = 'block';
        // Update depth label when switching to namespaces view
        if (depthValue) {
            depthValue.textContent = getDepthLabel(currentDepth, 'namespaces');
        }
    }

    // Update hash (unless we're just re-rendering due to slider change)
    if (!skipHashUpdate) {
        updateHash(null, null);
    }

    const svg = document.getElementById('treemap-svg');
    const breadcrumb = document.getElementById('breadcrumb');

    breadcrumb.innerHTML = '<span>Project</span>';

    const { width, height } = getSvgSize(svg);

    if (width <= 0 || height <= 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle">Unable to determine SVG dimensions</text>';
        return;
    }

    // Use depth-aware hierarchical structure if depth > 0
    let nodes;
    if (currentDepth > 0) {
        nodes = buildHierarchicalNamespaces(currentData.namespaces, currentDepth, 0);
    } else {
        // Depth 0: show only top-level namespaces (original behavior)
        nodes = currentData.namespaces.map(ns => ({
            id: ns.name,
            name: ns.name || 'Root',
            fullName: ns.name,
            weight: ns.coverable,
            coverable: ns.coverable,
            covered: ns.covered,
            percent: coveragePercent(ns.covered, ns.coverable),
            files: ns.files,
            namespaces: ns.namespaces || [],
            depth: 0,
            children: null,
            type: 'namespace',
        }));
    }

    const layout = generateTreemap(nodes, width, height, maxAspectRatio);
    svg.innerHTML = '';
    
    // Set SVG viewBox to match the coordinate system
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Create a map from node id to original node to preserve children
    const nodeMap = new Map();
    function buildNodeMap(nodeList) {
        for (const node of nodeList) {
            nodeMap.set(node.id, node);
            if (node.children) {
                buildNodeMap(node.children);
            }
        }
    }
    buildNodeMap(nodes);

    // Function to render a node and its nested children recursively
    function renderNodeWithChildren(layoutNode, parentSvg) {
        // Get the original node to access children
        const originalNode = nodeMap.get(layoutNode.id) || layoutNode;
        const node = { ...layoutNode, children: originalNode.children };
        // Use very small thresholds to ensure all nodes are rendered
        // Lowered threshold to 0.05 pixels to catch very thin but valid rectangles
        if (!isFinite(node.x) || !isFinite(node.y) || !isFinite(node.w) || !isFinite(node.h) || 
            node.w < 0.05 || node.h < 0.05) {
            return;
        }
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.x);
        rect.setAttribute('y', node.y);
        rect.setAttribute('width', node.w);
        rect.setAttribute('height', node.h);
        rect.setAttribute('fill', getCoverageColor(node.percent));
        rect.setAttribute('stroke', '#fff');
        
        // Visual distinction for nested namespaces: thicker border for deeper levels
        const depth = node.depth || 0;
        const strokeWidth = 1 + (depth * 0.5);
        rect.setAttribute('stroke-width', strokeWidth.toString());
        
        // Slight opacity variation for nested items
        if (depth > 0) {
            rect.setAttribute('opacity', (1 - depth * 0.1).toString());
        }
        
        rect.classList.add('treemap-rect');
        const nodeType = node.type || 'namespace';
        
        if (nodeType === 'namespace') {
            rect.dataset.namespace = node.fullName;
        } else if (nodeType === 'file') {
            rect.dataset.file = node.fullName;
        } else if (nodeType === 'method') {
            rect.dataset.method = node.fullName;
        }

        rect.addEventListener('mouseenter', (e) => {
            showTooltip(node, e);
        });
        rect.addEventListener('mouseleave', () => {
            hideTooltip();
        });
        rect.addEventListener('click', (e) => {
            // Prevent any event bubbling that might interfere
            e.stopPropagation();
            
            // Don't navigate if slider is currently changing
            if (isSliderChanging) {
                return;
            }
            
            if (nodeType === 'namespace') {
                // Navigate to namespace view
                // Use updateHash to ensure consistent hash handling
                updateHash(node.fullName, null);
                if (node.files && node.files.length > 0) {
                    renderFiles(node.fullName, node.files);
                } else {
                    renderFiles(node.fullName, []);
                }
            } else if (nodeType === 'file') {
                // Navigate to methods view
                if (node.methods && node.methods.length > 0) {
                    // Find the namespace for this file
                    const fileNamespace = currentNamespace || findNamespaceForFile(node.fullName);
                    updateHash(fileNamespace, node.name);
                    renderMethods(node.fullName, node.methods);
                }
            } else if (nodeType === 'method') {
                // Show method details
                showMethodDetails(node);
            }
        });
        
        rect.style.cursor = 'pointer';
        let displayName, title;
        if (nodeType === 'namespace') {
            displayName = depth > 0 ? node.name.split('/').pop() : node.name;
            const namespaceHash = '#' + encodeHash(node.fullName);
            title = `Click to view files in ${displayName} (${namespaceHash})`;
        } else if (nodeType === 'file') {
            displayName = node.name;
            const fileHash = '#' + encodeHash(node.fullName);
            title = `Click to view methods in ${displayName} (${fileHash})`;
        } else if (nodeType === 'method') {
            displayName = node.name;
            title = `Click to view details for ${displayName}`;
        }
        rect.title = title;

        parentSvg.appendChild(rect);

        // If this node has children, render them nested inside this rectangle
        if (node.children && node.children.length > 0) {
            // Create a nested treemap for the children within this parent's rectangle
            // Use a small padding to make the nesting visible
            const padding = 2;
            const childLayout = generateTreemap(
                node.children, 
                node.w - (padding * 2), 
                node.h - (padding * 2),
                maxAspectRatio
            );
            
            // Render each child node, offset by the parent's position and padding
            childLayout.forEach(childLayoutNode => {
                // Get the original child node to preserve its children
                const originalChild = nodeMap.get(childLayoutNode.id) || childLayoutNode;
                const childWithOffset = {
                    ...childLayoutNode,
                    children: originalChild.children,
                    x: node.x + childLayoutNode.x + padding,
                    y: node.y + childLayoutNode.y + padding,
                };
                renderNodeWithChildren(childWithOffset, parentSvg);
            });
        } else {
            // Only show text label if node has no children (to avoid clutter)
            if (node.w > 100 && node.h > 30) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', node.x + node.w / 2);
                text.setAttribute('y', node.y + node.h / 2);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('fill', '#fff');
                text.setAttribute('font-size', '12px');
                text.setAttribute('font-weight', 'bold');
                // Use the displayName we already calculated
                let labelDisplayName = displayName;
                if (!labelDisplayName) {
                    // Fallback if displayName wasn't set
                    if (nodeType === 'namespace') {
                        labelDisplayName = depth > 0 ? node.name.split('/').pop() : node.name;
                    } else {
                        labelDisplayName = node.name;
                    }
                }
                text.textContent = `${labelDisplayName}\n${node.percent}%`;
                parentSvg.appendChild(text);
            }
        }
    }

    // Render all top-level nodes and their nested children
    layout.forEach(node => {
        renderNodeWithChildren(node, svg);
    });

    updateStats();
}

/**
 * Render file-level treemap for a namespace.
 * @param {boolean} skipHashUpdate - If true, don't update the hash (useful for resize)
 */
function renderFiles(namespaceName, files, skipHashUpdate = false) {
    currentView = 'files';
    currentNamespace = namespaceName;
    currentFile = null;

    // Calculate max depth for this namespace and show depth control if needed
    const namespaceForDepth = findNamespaceByName(namespaceName);
    let namespaceMaxDepth = 0;
    if (namespaceForDepth) {
        namespaceMaxDepth = calculateMaxDepthForNamespace(namespaceForDepth);
    }
    
    const depthControl = document.getElementById('depth-control');
    const depthSlider = document.getElementById('depth-slider');
    const depthValue = document.getElementById('depth-value');
    
    if (depthControl && depthSlider && depthValue) {
        if (namespaceMaxDepth > 0) {
            depthControl.style.display = 'block';
            depthSlider.setAttribute('max', namespaceMaxDepth);
            depthSlider.setAttribute('value', currentDepth);
            depthValue.textContent = getDepthLabel(currentDepth, 'files');
            
            // Only replace slider if not currently being dragged (to preserve mouse capture)
            if (!isSliderChanging) {
                // Remove existing event listeners by cloning (clean way to remove all listeners)
                const newSlider = depthSlider.cloneNode(true);
                depthSlider.parentNode.replaceChild(newSlider, depthSlider);
                
                // Add new event listener
                newSlider.addEventListener('input', (e) => {
                    isSliderChanging = true;
                    currentDepth = parseInt(e.target.value, 10);
                    const depthValueEl = document.getElementById('depth-value');
                    if (depthValueEl) {
                        depthValueEl.textContent = getDepthLabel(currentDepth, 'files');
                    }
                    // Update hash with new depth (but don't trigger navigation)
                    updateHash(namespaceName, null, currentDepth);
                    // Re-render files view with new depth
                    renderFiles(namespaceName, files, true);
                    
                    // Reset flag after a short delay to allow any pending events to complete
                    setTimeout(() => {
                        isSliderChanging = false;
                    }, 100);
                });
            }
        } else {
            depthControl.style.display = 'none';
        }
    }

    // Update hash (unless we're just re-rendering due to resize)
    if (!skipHashUpdate) {
        updateHash(namespaceName, null);
    }

    const svg = document.getElementById('treemap-svg');
    const breadcrumb = document.getElementById('breadcrumb');
    
    // If files weren't provided, find them from the namespace structure
    if (!files || files.length === 0) {
        const namespace = findNamespaceByName(namespaceName);
        if (namespace) {
            files = namespace.files || [];
        }
    }

    const namespaceHash = '#' + encodeHash(namespaceName);
    // Build breadcrumb with parent namespaces
    const namespaceParts = namespaceName ? namespaceName.split('/') : [];
    let breadcrumbHtml = '<a href="#" onclick="window.location.hash=\'\'; return false;" style="color: #3b82f6; text-decoration: none;">Project</a>';
    
    if (namespaceParts.length > 0) {
        namespaceParts.forEach((part, index) => {
            const parentPath = namespaceParts.slice(0, index + 1).join('/');
            const parentHash = '#' + encodeHash(parentPath);
            if (index < namespaceParts.length - 1) {
                // Parent namespace - make it clickable
                breadcrumbHtml += ` / <a href="${parentHash}" style="color: #3b82f6; text-decoration: none;">${part}</a>`;
            } else {
                // Current namespace - not clickable
                breadcrumbHtml += ` / <span>${part}</span>`;
            }
        });
    }
    
    breadcrumb.innerHTML = breadcrumbHtml;

    const { width, height } = getSvgSize(svg);

    if (width <= 0 || height <= 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle">Unable to determine SVG dimensions</text>';
        return;
    }

    // Get namespace for rendering
    const namespaceForRender = namespaceForDepth || findNamespaceByName(namespaceName);
    const nestedNamespaces = namespaceForRender?.namespaces || [];
    
    // Check if we have anything to show (files or nested namespaces)
    if ((!files || files.length === 0) && nestedNamespaces.length === 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#666" font-size="14px">No files or sub-namespaces in this namespace</text>';
        updateStats();
        return;
    }
    
    // Use hierarchical structure if depth > 0, otherwise use flat structure
    let allNodes = [];
    if (currentDepth > 0 && namespaceForRender) {
        // Build hierarchical structure
        allNodes = buildHierarchicalNamespaceContent(namespaceForRender, currentDepth, 0);
    } else {
        // Depth 0: Flat structure (original behavior)
        // Add files as nodes
        if (files && files.length > 0) {
            files.forEach(file => {
                const weight = file.coverable > 0 ? file.coverable : 0.5;
                allNodes.push({
                    id: file.fullPath || file.name,
                    name: file.name,
                    fullName: file.fullPath || file.name,
                    weight: weight,
                    coverable: file.coverable,
                    covered: file.covered,
                    percent: coveragePercent(file.covered, file.coverable),
                    methods: file.methods,
                    depth: 0,
                    children: null,
                    type: 'file',
                });
            });
        }
        
        // Add nested namespaces as nodes
        nestedNamespaces.forEach(ns => {
            allNodes.push({
                id: ns.name,
                name: ns.name.split('/').pop(),
                fullName: ns.name,
                weight: ns.coverable,
                coverable: ns.coverable,
                covered: ns.covered,
                percent: coveragePercent(ns.covered, ns.coverable),
                files: ns.files,
                namespaces: ns.namespaces || [],
                depth: 0,
                children: null,
                type: 'namespace',
            });
        });
    }
    
    // Handle empty case
    if (allNodes.length === 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#666" font-size="14px">No files or sub-namespaces in this namespace</text>';
        updateStats();
        return;
    }

    const layout = generateTreemap(allNodes, width, height, maxAspectRatio);
    svg.innerHTML = '';
    
    // Set SVG viewBox to match the coordinate system
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Create a map from node id to original node to preserve children
    const nodeMap = new Map();
    function buildNodeMap(nodeList) {
        for (const node of nodeList) {
            nodeMap.set(node.id, node);
            if (node.children) {
                buildNodeMap(node.children);
            }
        }
    }
    buildNodeMap(allNodes);

    // Function to render a node and its nested children recursively (same as in renderNamespaces)
    function renderNodeWithChildren(layoutNode, parentSvg) {
        // Get the original node to access children
        const originalNode = nodeMap.get(layoutNode.id) || layoutNode;
        const node = { ...layoutNode, children: originalNode.children };
        
        // Use very small thresholds to ensure all nodes are rendered
        if (!isFinite(node.x) || !isFinite(node.y) || !isFinite(node.w) || !isFinite(node.h) || 
            node.w < 0.05 || node.h < 0.05) {
            return;
        }
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.x);
        rect.setAttribute('y', node.y);
        rect.setAttribute('width', node.w);
        rect.setAttribute('height', node.h);
        rect.setAttribute('fill', getCoverageColor(node.percent));
        rect.setAttribute('stroke', '#fff');
        
        const depth = node.depth || 0;
        const strokeWidth = 1 + (depth * 0.5);
        rect.setAttribute('stroke-width', strokeWidth.toString());
        
        if (depth > 0) {
            rect.setAttribute('opacity', (1 - depth * 0.1).toString());
        }
        
        rect.classList.add('treemap-rect');
        const nodeType = node.type || 'file';
        
        if (nodeType === 'namespace') {
            rect.dataset.namespace = node.fullName;
        } else if (nodeType === 'file') {
            rect.dataset.file = node.fullName;
        } else if (nodeType === 'method') {
            rect.dataset.method = node.fullName;
        }

        rect.addEventListener('mouseenter', (e) => {
            showTooltip(node, e);
        });
        rect.addEventListener('mouseleave', () => {
            hideTooltip();
        });
        rect.addEventListener('click', (e) => {
            // Prevent any event bubbling that might interfere
            e.stopPropagation();
            
            // Don't navigate if slider is currently changing
            if (isSliderChanging) {
                return;
            }
            
            if (nodeType === 'namespace') {
                // Navigate to namespace view
                // Use updateHash to ensure consistent hash handling
                updateHash(node.fullName, null);
                if (node.files && node.files.length > 0) {
                    renderFiles(node.fullName, node.files);
                } else {
                    renderFiles(node.fullName, []);
                }
            } else if (nodeType === 'file') {
                // Navigate to methods view
                if (node.methods && node.methods.length > 0) {
                    const fullPath = currentNamespace ? `${currentNamespace}/${node.name}` : node.name;
                    updateHash(currentNamespace, node.name);
                    renderMethods(node.fullName, node.methods);
                }
            } else if (nodeType === 'method') {
                // Show method details
                showMethodDetails(node);
            }
        });
        
        rect.style.cursor = 'pointer';
        let displayName, title;
        if (nodeType === 'namespace') {
            displayName = node.name;
            const namespaceHash = '#' + encodeHash(node.fullName);
            title = `Click to view ${displayName} namespace (${namespaceHash})`;
        } else if (nodeType === 'file') {
            displayName = node.name;
            const fullPath = currentNamespace ? `${currentNamespace}/${node.name}` : node.name;
            const fileHash = '#' + encodeHash(fullPath);
            title = `Click to view methods in ${displayName} (${fileHash})`;
        } else if (nodeType === 'method') {
            displayName = node.name;
            title = `Click to view details for ${displayName}`;
        }
        rect.title = title;

        parentSvg.appendChild(rect);

        // If this node has children, render them nested inside this rectangle
        if (node.children && node.children.length > 0) {
            const padding = 2;
            const childLayout = generateTreemap(
                node.children, 
                node.w - (padding * 2), 
                node.h - (padding * 2),
                maxAspectRatio
            );
            
            childLayout.forEach(childLayoutNode => {
                const originalChild = nodeMap.get(childLayoutNode.id) || childLayoutNode;
                const childWithOffset = {
                    ...childLayoutNode,
                    children: originalChild.children,
                    x: node.x + childLayoutNode.x + padding,
                    y: node.y + childLayoutNode.y + padding,
                };
                renderNodeWithChildren(childWithOffset, parentSvg);
            });
        } else {
            // Only show text label if node has no children
            if (node.w > 50 && node.h > 20) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', node.x + node.w / 2);
                text.setAttribute('y', node.y + node.h / 2);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('fill', '#fff');
                text.setAttribute('font-size', node.w > 100 && node.h > 30 ? '12px' : '10px');
                text.setAttribute('font-weight', 'bold');
                const percentText = typeof node.percent === 'string' && node.percent === 'N/A' ? 'N/A' : `${node.percent}%`;
                text.textContent = node.w > 100 && node.h > 30 ? `${displayName}\n${percentText}` : displayName;
                parentSvg.appendChild(text);
            }
        }
    }

    // Render all top-level nodes and their nested children
    layout.forEach(node => {
        renderNodeWithChildren(node, svg);
    });

    updateStats();
}

/**
 * Render method-level treemap for a file.
 * @param {boolean} skipHashUpdate - If true, don't update the hash (useful for resize)
 */
function renderMethods(fileName, methods, skipHashUpdate = false) {
    currentView = 'methods';
    currentFile = fileName;

    // Hide depth slider when viewing methods
    const depthControl = document.getElementById('depth-control');
    if (depthControl) {
        depthControl.style.display = 'none';
    }

    // Ensure we have a namespace - if not, try to find it from the file
    if (!currentNamespace) {
        // Try to find which namespace contains this file
        for (const ns of currentData.namespaces) {
            const fileObj = ns.files.find(f => 
                (f.fullPath || f.name) === fileName || f.name === fileName
            );
            if (fileObj) {
                currentNamespace = ns.name;
                break;
            }
        }
    }

    // Update hash - need to find the file's actual name
    const fileObj = currentNamespace ? 
        currentData.namespaces.find(ns => ns.name === currentNamespace)?.files.find(f => 
            (f.fullPath || f.name) === fileName || f.name === fileName
        ) : null;
    const fileDisplayName = fileObj ? fileObj.name : fileName.split('/').pop();
    
    updateHash(currentNamespace, fileDisplayName);

    const svg = document.getElementById('treemap-svg');
    const breadcrumb = document.getElementById('breadcrumb');

    // Build breadcrumb with nested namespaces properly split
    let breadcrumbHtml = '<a href="#" onclick="window.location.hash=\'\'; return false;" style="color: #3b82f6; text-decoration: none;">Project</a>';
    
    if (currentNamespace) {
        // Split namespace into parts (e.g., "Models/Ingredients" -> ["Models", "Ingredients"])
        const namespaceParts = currentNamespace.split('/');
        namespaceParts.forEach((part, index) => {
            const parentPath = namespaceParts.slice(0, index + 1).join('/');
            const parentHash = '#' + encodeHash(parentPath);
            // All namespace parts are clickable links
            breadcrumbHtml += ` / <a href="${parentHash}" style="color: #3b82f6; text-decoration: none;">${part}</a>`;
        });
    }
    
    // Add the file name as the final non-clickable part (use the already declared fileDisplayName)
    breadcrumb.innerHTML = breadcrumbHtml + ` / <span>${fileDisplayName}</span>`;

    // Update hash (unless we're just re-rendering due to resize)
    if (!skipHashUpdate) {
        updateHash(currentNamespace, fileDisplayName);
    }

    const { width, height } = getSvgSize(svg);

    // Ensure valid dimensions
    if (width <= 0 || height <= 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle">Unable to determine SVG dimensions</text>';
        return;
    }

    // Check if we have any methods
    if (!methods || methods.length === 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#666" font-size="14px">No methods found in this file</text>';
        updateStats();
        return;
    }

    // Map methods to nodes - use coverable as weight
    // For methods with 0 coverable, use a small but non-zero weight so they still render
    const nodes = methods.map(method => ({
        id: method.name,
        name: method.name.split('::').pop(),
        fullName: method.name,
        weight: method.coverable > 0 ? method.coverable : 0.5, // Small weight for zero-coverage methods
        coverable: method.coverable,
        covered: method.covered,
        percent: coveragePercent(method.covered, method.coverable),
        tests: method.tests || [],
    }));

    const layout = generateTreemap(nodes, width, height, maxAspectRatio);
    
    // If no layout generated, show a message
    if (layout.length === 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#666" font-size="14px">Unable to generate treemap layout</text>';
        updateStats();
        return;
    }

    svg.innerHTML = '';
    
    // Set SVG viewBox to match the coordinate system
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    layout.forEach(node => {
        // Validate node dimensions
        if (!isFinite(node.x) || !isFinite(node.y) || !isFinite(node.w) || !isFinite(node.h) || 
            node.w <= 0 || node.h <= 0) {
            return; // Skip invalid nodes
        }
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.x);
        rect.setAttribute('y', node.y);
        rect.setAttribute('width', node.w);
        rect.setAttribute('height', node.h);
        rect.setAttribute('fill', getCoverageColor(node.percent));
        rect.setAttribute('stroke', '#fff');
        rect.setAttribute('stroke-width', '1');
        rect.classList.add('treemap-rect');
        rect.dataset.method = node.fullName;

        rect.addEventListener('mouseenter', () => {
            showTooltip(node, event);
        });
        rect.addEventListener('mouseleave', () => {
            hideTooltip();
        });
        rect.addEventListener('click', () => {
            showMethodDetails(node);
        });

        svg.appendChild(rect);

        if (node.w > 80 && node.h > 25) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', node.x + node.w / 2);
            text.setAttribute('y', node.y + node.h / 2);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('fill', '#fff');
            text.setAttribute('font-size', '11px');
            text.textContent = `${node.name}\n${node.percent}%`;
            svg.appendChild(text);
        }
    });

    updateStats();
}

/**
 * Show tooltip on hover.
 */
function showTooltip(node, event) {
    const tooltip = document.getElementById('tooltip');
    tooltip.innerHTML = `
        <strong>${node.fullName || node.name}</strong><br>
        Coverage: ${node.covered}/${node.coverable} (${node.percent}%)<br>
        ${node.tests ? `Tests: ${node.tests.length}` : ''}
    `;
    tooltip.style.display = 'block';
    tooltip.style.left = event.pageX + 10 + 'px';
    tooltip.style.top = event.pageY + 10 + 'px';
}

/**
 * Hide tooltip.
 */
function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
}

/**
 * Show method details.
 */
function showMethodDetails(method) {
    const details = document.getElementById('method-details');
    details.innerHTML = `
        <h3>${method.fullName}</h3>
        <p>Coverage: ${method.covered}/${method.coverable} (${method.percent}%)</p>
        ${method.tests && method.tests.length > 0 ? `
            <h4>Tests covering this method:</h4>
            <ul>
                ${method.tests.map(test => `<li>${test}</li>`).join('')}
            </ul>
        ` : '<p>No tests cover this method.</p>'}
    `;
    details.style.display = 'block';
}

/**
 * Update statistics display.
 */
function updateStats() {
    if (!currentData) {
        return;
    }

    let totalCoverable = 0;
    let totalCovered = 0;

    if (currentView === 'namespaces') {
        currentData.namespaces.forEach(ns => {
            totalCoverable += ns.coverable;
            totalCovered += ns.covered;
        });
    } else if (currentView === 'files' && currentNamespace) {
        const namespace = findNamespaceByName(currentNamespace);
        if (namespace) {
            namespace.files.forEach(file => {
                totalCoverable += file.coverable;
                totalCovered += file.covered;
            });
        }
    } else if (currentFile) {
        // Find file in current namespace
        if (currentNamespace) {
            const namespace = findNamespaceByName(currentNamespace);
            if (namespace) {
                const file = namespace.files.find(f => (f.fullPath || f.name) === currentFile);
                if (file && file.methods) {
                    file.methods.forEach(method => {
                        totalCoverable += method.coverable;
                        totalCovered += method.covered;
                    });
                }
            }
        }
    }

    const percent = coveragePercent(totalCovered, totalCoverable);
    document.getElementById('stats').textContent =
        `Total Coverage: ${totalCovered}/${totalCoverable} (${percent}%)`;
}

function rerenderCurrentView() {
    if (!currentData) return;

    // Save current hash to preserve it during resize
    const currentHash = window.location.hash;

    if (currentView === 'namespaces') {
        renderNamespaces(true); // Skip hash update during resize
        // Restore hash if it changed
        if (window.location.hash !== currentHash) {
            history.replaceState(null, '', currentHash);
        }
        return;
    }

    if (currentView === 'files' && currentNamespace) {
        const ns = findNamespaceByName(currentNamespace);
        if (ns) {
            renderFiles(currentNamespace, ns.files || [], true); // Skip hash update
            // Restore hash if it changed
            if (window.location.hash !== currentHash) {
                history.replaceState(null, '', currentHash);
            }
            return;
        }
    }

    if (currentView === 'methods' && currentFile) {
        // Try to locate the file within the current namespace first
        let ns = currentNamespace ? findNamespaceByName(currentNamespace) : null;
        let fileObj = ns ? ns.files.find(f => (f.fullPath || f.name) === currentFile) : null;

        // Fallback: search all namespaces
        if (!fileObj) {
            for (const n of currentData.namespaces) {
                const f = n.files.find(f => (f.fullPath || f.name) === currentFile);
                if (f) {
                    ns = n;
                    fileObj = f;
                    break;
                }
            }
        }

        if (fileObj && ns) {
            currentNamespace = ns.name;
            renderMethods(fileObj.fullPath || fileObj.name, fileObj.methods || [], true); // Skip hash update
            // Restore hash if it changed
            if (window.location.hash !== currentHash) {
                history.replaceState(null, '', currentHash);
            }
            return;
        }
    }

    // Fallback
    renderNamespaces();
    // Restore hash if it changed
    if (window.location.hash !== currentHash) {
        history.replaceState(null, '', currentHash);
    }
}

// Make functions available globally for breadcrumb navigation
window.renderNamespaces = renderNamespaces;
window.renderFiles = renderFiles;

// Handle hash changes (back/forward buttons, direct links)
window.addEventListener('hashchange', () => {
    navigateFromHash();
});

// Re-render on resize with debounce
resizeHandler = debounce(() => {
    rerenderCurrentView();
}, 200);
window.addEventListener('resize', resizeHandler);

// Initialize on load
document.addEventListener('DOMContentLoaded', loadData);

