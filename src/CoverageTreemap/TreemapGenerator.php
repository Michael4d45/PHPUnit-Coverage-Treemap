<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap;

/**
 * Generate treemap data structure and output JSON.
 */
final class TreemapGenerator
{
    private string $outputDirectory;

    private array $sourceDirectories;

    private array $excludedDirectories;

    private string $defaultNamespace;

    private string $projectRoot;

    public function __construct(string|null $outputDirectory = null)
    {
        $config = Extension::config();
        $this->outputDirectory = $outputDirectory ?? $config->outputDirectory();
        $this->sourceDirectories = $config->sourceDirectories();
        $this->excludedDirectories = $config->excludedDirectories();
        $this->defaultNamespace = $config->defaultNamespace();

        // Find project root (directory containing phpunit.xml)
        $this->projectRoot = getcwd() ?: __DIR__;
        $dir = __DIR__;
        while ($dir !== '/' && $dir !== '') {
            if (file_exists($dir . '/phpunit.xml')) {
                $this->projectRoot = $dir;
                break;
            }
            $dir = dirname($dir);
        }
    }

    public function generate(): void
    {
        $testCoverage = CoverageStore::getTestCoverage();
        $coverableLines = CoverageStore::getCoverableLines();
        $methodMap = CoverageStore::getMethodMap();

        // Build hierarchical structure grouped by namespace
        $namespaces = [];

        // Get all PHP files from source directories, respecting phpunit.xml exclusions
        $allAppFiles = $this->getAllSourceFiles();

        // Get all files - from coverage data, method map, AND directory scan
        // This ensures ALL files are included, even if they have no coverage
        $allFiles = array_unique(array_merge(
            array_keys($coverableLines),
            array_keys($methodMap),
            $allAppFiles
        ));

        foreach ($allFiles as $file) {
            // Get coverable lines for this file (may be empty if file has no coverage)
            $coverableLineNumbers = $coverableLines[$file] ?? [];
            $fileMethods = $methodMap[$file] ?? [];
            $fileCoveredLines = $this->getFileCoveredLines($file, $testCoverage);

            // Calculate file-level stats
            $fileCoverable = count($coverableLineNumbers);
            $fileCovered = count(array_intersect($coverableLineNumbers, $fileCoveredLines));

            // Extract namespace from file path
            $namespace = $this->extractNamespace($file);
            $fileName = basename($file);

            // Build methods
            $methods = [];
            foreach ($fileMethods as $methodName => [$startLine, $endLine]) {
                $methodCoverableLines = array_filter(
                    $coverableLineNumbers,
                    fn (int $line) => $line >= $startLine && $line <= $endLine
                );
                $methodCoveredLines = array_filter(
                    $fileCoveredLines,
                    fn (int $line) => $line >= $startLine && $line <= $endLine
                );

                $methodCoverable = count($methodCoverableLines);
                $methodCovered = count(array_intersect($methodCoverableLines, $methodCoveredLines));

                // Find tests that cover this method
                $methodTests = $this->getTestsCoveringLines($file, array_values($methodCoverableLines), $testCoverage);

                $methods[] = [
                    'name' => $methodName,
                    'coverable' => $methodCoverable,
                    'covered' => $methodCovered,
                    'tests' => array_values($methodTests),
                ];
            }

            // Build hierarchical namespace structure
            // Split namespace by '/' to create nested structure
            $namespaceParts = $namespace === '' ? [] : explode('/', $namespace);
            $currentLevel = &$namespaces;

            // Navigate/create the namespace hierarchy
            foreach ($namespaceParts as $index => $part) {
                if (! isset($currentLevel[$part])) {
                    $currentLevel[$part] = [
                        'name' => $part,
                        'fullName' => implode('/', array_slice($namespaceParts, 0, $index + 1)),
                        'coverable' => 0,
                        'covered' => 0,
                        'files' => [],
                        'namespaces' => [],
                    ];
                }

                // If this is the last part, we're at the target namespace level
                if ($index === count($namespaceParts) - 1) {
                    // Add file to this namespace level
                    $currentLevel[$part]['files'][] = [
                        'name' => $fileName,
                        'fullPath' => $file,
                        'coverable' => $fileCoverable,
                        'covered' => $fileCovered,
                        'methods' => $methods,
                    ];

                    // Update this namespace's totals
                    if (! isset($currentLevel[$part]['coverable'])) {
                        $currentLevel[$part]['coverable'] = 0;
                    }
                    if (! isset($currentLevel[$part]['covered'])) {
                        $currentLevel[$part]['covered'] = 0;
                    }
                    $currentLevel[$part]['coverable'] += $fileCoverable;
                    $currentLevel[$part]['covered'] += $fileCovered;
                } else {
                    // Move to next level (nested namespace)
                    if (! isset($currentLevel[$part]['namespaces'])) {
                        $currentLevel[$part]['namespaces'] = [];
                    }
                    $currentLevel = &$currentLevel[$part]['namespaces'];
                }
            }

            // If namespace is empty (file in source root), add it directly
            if (empty($namespaceParts)) {
                $rootNamespace = $this->defaultNamespace;
                if (! isset($namespaces[$rootNamespace])) {
                    $namespaces[$rootNamespace] = [
                        'name' => $rootNamespace,
                        'coverable' => 0,
                        'covered' => 0,
                        'files' => [],
                        'namespaces' => [],
                    ];
                }
                $namespaces[$rootNamespace]['files'][] = [
                    'name' => $fileName,
                    'fullPath' => $file,
                    'coverable' => $fileCoverable,
                    'covered' => $fileCovered,
                    'methods' => $methods,
                ];
                $namespaces[$rootNamespace]['coverable'] += $fileCoverable;
                $namespaces[$rootNamespace]['covered'] += $fileCovered;
            }

            // Update parent namespaces totals
            $parentLevel = &$namespaces;
            foreach ($namespaceParts as $index => $part) {
                if (! isset($parentLevel[$part])) {
                    continue; // Skip if parent doesn't exist
                }
                if (! isset($parentLevel[$part]['coverable'])) {
                    $parentLevel[$part]['coverable'] = 0;
                }
                if (! isset($parentLevel[$part]['covered'])) {
                    $parentLevel[$part]['covered'] = 0;
                }
                $parentLevel[$part]['coverable'] += $fileCoverable;
                $parentLevel[$part]['covered'] += $fileCovered;

                // Move to nested level for next iteration (if not last part)
                if ($index < count($namespaceParts) - 1 && isset($parentLevel[$part]['namespaces'])) {
                    $parentLevel = &$parentLevel[$part]['namespaces'];
                }
            }
        }

        // Flatten the hierarchical structure while preserving nested namespaces
        // The $namespaces array is hierarchical: $namespaces['Http']['namespaces']['Controllers']
        // We need to flatten it to: top-level namespaces with nested namespaces in their 'namespaces' array
        $flattenNamespace = function ($nsData, $fullName = '') use (&$flattenNamespace) {
            $result = [
                'name' => $fullName ?: $nsData['name'],
                'coverable' => $nsData['coverable'] ?? 0,
                'covered' => $nsData['covered'] ?? 0,
                'files' => $nsData['files'] ?? [],
                'namespaces' => [],
            ];

            // Process nested namespaces
            if (isset($nsData['namespaces']) && is_array($nsData['namespaces'])) {
                foreach ($nsData['namespaces'] as $nestedName => $nestedData) {
                    $nestedFullName = $fullName ? $fullName . '/' . $nestedName : $nestedName;
                    $result['namespaces'][] = $flattenNamespace($nestedData, $nestedFullName);
                }
            }

            return $result;
        };

        $namespaceArray = [];
        foreach ($namespaces as $nsName => $nsData) {
            $namespaceArray[] = $flattenNamespace($nsData, $nsName);
        }

        usort($namespaceArray, fn ($a, $b) => strcmp($a['name'], $b['name']));

        $data = [
            'namespaces' => $namespaceArray,
        ];

        // Ensure output directory exists
        if (! is_dir($this->outputDirectory)) {
            \mkdir($this->outputDirectory, 0755, true);
        }

        // Generate single HTML file with embedded data and scripts
        $this->generateSingleHtmlFile($data);
    }

    /**
     * Get all covered lines for a file across all tests.
     *
     * @param  array<string, array<string, array<int, int>>>  $testCoverage
     * @return array<int>
     */
    private function getFileCoveredLines(string $file, array $testCoverage): array
    {
        $coveredLines = [];

        foreach ($testCoverage as $testCoverageData) {
            if (isset($testCoverageData[$file])) {
                foreach ($testCoverageData[$file] as $line => $hitCount) {
                    if ($hitCount > 0) {
                        $coveredLines[] = $line;
                    }
                }
            }
        }

        return array_unique($coveredLines);
    }

    /**
     * Get tests that cover specific lines in a file.
     *
     * @param  array<int>  $lines
     * @param  array<string, array<string, array<int, int>>>  $testCoverage
     * @return array<string>
     */
    private function getTestsCoveringLines(string $file, array $lines, array $testCoverage): array
    {
        $tests = [];

        foreach ($testCoverage as $testId => $testCoverageData) {
            if (! isset($testCoverageData[$file])) {
                continue;
            }

            foreach ($lines as $line) {
                if (isset($testCoverageData[$file][$line]) && $testCoverageData[$file][$line] > 0) {
                    $tests[] = $testId;
                    break; // Test covers at least one line, move to next test
                }
            }
        }

        return array_unique($tests);
    }

    /**
     * Get all PHP files from source directories, respecting phpunit.xml exclusions.
     *
     * @return array<string> Array of full file paths
     */
    private function getAllSourceFiles(): array
    {
        $files = [];

        foreach ($this->sourceDirectories as $sourceDir) {
            $sourcePath = $this->projectRoot . '/' . $sourceDir;

            if (! is_dir($sourcePath)) {
                continue;
            }

            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($sourcePath, \RecursiveDirectoryIterator::SKIP_DOTS)
            );

            foreach ($iterator as $file) {
                if ($file->isFile() && $file->getExtension() === 'php') {
                    $fullPath = $file->getPathname();
                    $relativePath = str_replace($this->projectRoot . DIRECTORY_SEPARATOR, '', $fullPath);
                    $relativePath = str_replace('\\', '/', $relativePath);

                    // Check if file is in excluded directory
                    $excluded = false;
                    foreach ($this->excludedDirectories as $excludedDir) {
                        $excludedPath = str_replace('\\', '/', $excludedDir);
                        if (strpos($relativePath, $excludedPath . '/') === 0 || $relativePath === $excludedPath) {
                            $excluded = true;
                            break;
                        }
                    }

                    if (! $excluded) {
                        $files[] = $fullPath;
                    }
                }
            }
        }

        return $files;
    }

    /**
     * Extract namespace from file path based on source directories.
     *
     * @param  string  $file  Full file path
     * @return string Namespace path (e.g., "Http/Controllers" or "Services")
     */
    private function extractNamespace(string $file): string
    {
        // Normalize path separators
        $file = str_replace('\\', '/', $file);
        $projectRoot = str_replace('\\', '/', $this->projectRoot);

        // Try to find which source directory this file belongs to
        foreach ($this->sourceDirectories as $sourceDir) {
            $sourcePath = str_replace('\\', '/', $sourceDir);
            $fullSourcePath = $projectRoot . '/' . $sourcePath;

            // Check if file is within this source directory
            if (strpos($file, $fullSourcePath . '/') === 0 || $file === $fullSourcePath) {
                // Extract path after source directory
                $afterSource = substr($file, strlen($fullSourcePath) + 1);
                $dir = dirname($afterSource);

                // If directory is '.' or empty, it's in source root
                if ($dir === '.' || $dir === '') {
                    return '';
                }

                return $dir;
            }
        }

        // Fallback: if file doesn't match any source directory, use relative path from project root
        if (strpos($file, $projectRoot . '/') === 0) {
            $relativePath = substr($file, strlen($projectRoot) + 1);
            $dir = dirname($relativePath);

            return ($dir === '.' || $dir === '') ? '' : $dir;
        }

        // Last resort: use directory name
        $dir = dirname($file);

        return basename($dir) ?: '';
    }

    private function generateSingleHtmlFile(array $data): void
    {
        // Resource directory - when installed as package, it's in vendor/your-vendor/coverage-treemap/resources
        // Go up from src/CoverageTreemap to package root, then to resources
        $packageRoot = dirname(__DIR__, 2); // Go up 2 levels from src/CoverageTreemap to package root
        $sourceDir = $packageRoot . '/resources/coverage-treemap';

        // If that doesn't exist (development mode), try vendor path
        if (! is_dir($sourceDir)) {
            // When installed: vendor/michael4d45/coverage-treemap/resources/coverage-treemap
            // Go up 4 levels from src/CoverageTreemap to vendor level
            $vendorDir = dirname(__DIR__, 4);
            $sourceDir = $vendorDir . '/michael4d45/coverage-treemap/resources/coverage-treemap';
        }

        // Last resort: try project root (for development)
        if (! is_dir($sourceDir)) {
            $sourceDir = $this->projectRoot . '/resources/coverage-treemap';
        }

        if (! is_dir($sourceDir)) {
            throw new \RuntimeException("Could not find resources directory. Tried: {$sourceDir}");
        }

        // Read JavaScript files (plain JavaScript, no modules)
        $treemapJs = @file_get_contents($sourceDir . '/treemap.js');
        $uiJs = @file_get_contents($sourceDir . '/ui.js');
        
        if ($treemapJs === false) {
            throw new \RuntimeException("Could not read treemap.js from: {$sourceDir}/treemap.js");
        }
        
        if ($uiJs === false) {
            throw new \RuntimeException("Could not read ui.js from: {$sourceDir}/ui.js");
        }

        // Embed JSON data as JavaScript variable
        $jsonData = \json_encode($data, \JSON_PRETTY_PRINT | \JSON_UNESCAPED_SLASHES);
        $embeddedData = "const COVERAGE_DATA = {$jsonData};\n";

        // Combine into inline script block
        $scripts = <<<JS
    <script>
        // Embedded coverage data
        {$embeddedData}

        // Treemap algorithm
        {$treemapJs}

        // UI code
        {$uiJs}
    </script>
JS;

        // Read HTML template
        $html = @file_get_contents($sourceDir . '/index.html');
        
        if ($html === false) {
            throw new \RuntimeException("Could not read index.html from: {$sourceDir}/index.html");
        }

        // Replace script tag with embedded scripts
        $html = str_replace(
            '<script type="module" src="ui.js"></script>',
            $scripts,
            $html
        );

        // Write single HTML file
        $htmlPath = $this->outputDirectory . '/index.html';
        if (@file_put_contents($htmlPath, $html) === false) {
            throw new \RuntimeException("Could not write HTML file to: {$htmlPath}");
        }

        // Clean up old separate files if they exist
        $oldFiles = [
            $this->outputDirectory . '/data.json',
            $this->outputDirectory . '/treemap.js',
            $this->outputDirectory . '/ui.js',
        ];

        foreach ($oldFiles as $oldFile) {
            if (file_exists($oldFile)) {
                unlink($oldFile);
            }
        }
    }
}

