<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap\Subscribers;

use CoverageTreemap\CoverageTreemap\CoverageStore;
use CoverageTreemap\CoverageTreemap\Extension;
use CoverageTreemap\CoverageTreemap\MethodExtractor;
use CoverageTreemap\CoverageTreemap\TreemapGenerator;
use PHPUnit\Event\TestRunner\Finished;
use PHPUnit\Event\TestRunner\FinishedSubscriber;
use PHPUnit\Runner\CodeCoverage;

final class TestRunnerFinished implements FinishedSubscriber
{
    public function notify(Finished $event): void
    {
        $codeCoverage = CodeCoverage::instance();

        if (! $codeCoverage->isActive()) {
            return;
        }

        // Get the coverage data object
        $coverage = $codeCoverage->codeCoverage();

        if ($coverage === null) {
            return;
        }

        // Get the coverage data
        try {
            $data = $coverage->getData();
        } catch (\Throwable $e) {
            // Fallback: try to get data differently or skip
            echo "\nWarning: Could not access coverage data: " . $e->getMessage() . "\n";

            return;
        }

        // Extract coverable lines and coverage information
        $coverableLines = [];
        $testCoverage = [];

        // Access line coverage data
        try {
            $lineCoverage = $data->lineCoverage();
        } catch (\Throwable $e) {
            echo "\nWarning: Could not access line coverage: " . $e->getMessage() . "\n";

            return;
        }

        // Get all executable lines (statements) - this includes ALL coverable lines, not just covered ones
        $executableLines = [];
        try {
            if (method_exists($data, 'executableLines')) {
                $executableLines = $data->executableLines();
            } elseif (method_exists($data, 'statements')) {
                $executableLines = $data->statements();
            }
        } catch (\Throwable $e) {
            // If we can't get executable lines, we'll use lineCoverage as fallback
            // but this means we'll miss lines that weren't executed
        }

        // First, initialize coverableLines from executableLines (if available)
        // This ensures we have ALL executable lines, not just covered ones
        if (! empty($executableLines)) {
            foreach ($executableLines as $file => $lines) {
                $coverableLines[$file] = array_map('intval', array_keys($lines));
            }
        }

        // Then, process lineCoverage to track which lines are covered by which tests
        foreach ($lineCoverage as $file => $lines) {
            // If we don't have executable lines for this file, use lineCoverage as fallback
            if (! isset($coverableLines[$file])) {
                $coverableLineNumbers = [];
                foreach ($lines as $line => $testIds) {
                    $coverableLineNumbers[] = (int) $line;
                }
                $coverableLines[$file] = $coverableLineNumbers;
            }

            // Track which tests cover which lines
            foreach ($lines as $line => $testIds) {
                if (is_array($testIds) && count($testIds) > 0) {
                    foreach ($testIds as $testId) {
                        if (! isset($testCoverage[$testId])) {
                            $testCoverage[$testId] = [];
                        }
                        if (! isset($testCoverage[$testId][$file])) {
                            $testCoverage[$testId][$file] = [];
                        }
                        $testCoverage[$testId][$file][(int) $line] = 1;
                    }
                }
            }

            $coverableLines[$file] = $coverableLineNumbers;
        }

        CoverageStore::setCoverableLines($coverableLines);

        // Store test coverage
        foreach ($testCoverage as $testId => $coverageData) {
            CoverageStore::addTestCoverage($testId, $coverageData);
        }

        // Extract methods from all files that appear in coverage
        // Also need to get executable lines for files that might not have coverage yet
        $allFiles = array_keys($coverableLines);

        // Try to get executable lines for all files from the coverage data
        try {
            if (method_exists($data, 'executableLines')) {
                $allExecutableLines = $data->executableLines();
                // Merge executable lines with coverable lines
                foreach ($allExecutableLines as $file => $lines) {
                    if (! isset($coverableLines[$file])) {
                        // File has executable lines but no coverage yet
                        $coverableLines[$file] = array_map('intval', array_keys($lines));
                    } else {
                        // Merge: add any executable lines that aren't already in coverableLines
                        $existing = array_flip($coverableLines[$file]);
                        foreach (array_keys($lines) as $line) {
                            if (! isset($existing[$line])) {
                                $coverableLines[$file][] = (int) $line;
                            }
                        }
                        // Sort and deduplicate
                        $coverableLines[$file] = array_values(array_unique($coverableLines[$file]));
                        sort($coverableLines[$file]);
                    }
                    $allFiles[] = $file;
                }
                $allFiles = array_unique($allFiles);
                CoverageStore::setCoverableLines($coverableLines);
            }
        } catch (\Throwable $e) {
            // If we can't get executable lines, continue with what we have
        }

        // Get current methodMap from CoverageStore to check what's already extracted
        $existingMethodMap = CoverageStore::getMethodMap();

        // Extract methods from all files (both covered and executable)
        // Also scan source directories for all PHP files to ensure nothing is missed
        $config = Extension::config();
        $sourceDirectories = $config->sourceDirectories();
        $excludedDirectories = $config->excludedDirectories();

        // Get project root - find phpunit.xml and use its directory
        $projectRoot = getcwd() ?: __DIR__;
        $dir = __DIR__;
        while ($dir !== '/' && $dir !== '') {
            if (file_exists($dir . '/phpunit.xml')) {
                $projectRoot = $dir;
                break;
            }
            $dir = dirname($dir);
        }

        foreach ($sourceDirectories as $sourceDir) {
            $sourcePath = $projectRoot . '/' . $sourceDir;
            if (! is_dir($sourcePath)) {
                continue;
            }

            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($sourcePath, \RecursiveDirectoryIterator::SKIP_DOTS)
            );

            foreach ($iterator as $file) {
                if ($file->isFile() && $file->getExtension() === 'php') {
                    $fullPath = $file->getPathname();
                    $relativePath = str_replace($projectRoot . DIRECTORY_SEPARATOR, '', $fullPath);
                    $relativePath = str_replace('\\', '/', $relativePath);

                    // Check if file is in excluded directory
                    $excluded = false;
                    foreach ($excludedDirectories as $excludedDir) {
                        $excludedPath = str_replace('\\', '/', $excludedDir);
                        if (strpos($relativePath, $excludedPath . '/') === 0 || $relativePath === $excludedPath) {
                            $excluded = true;
                            break;
                        }
                    }

                    if (! $excluded && ! isset($existingMethodMap[$fullPath])) {
                        // Extract methods for files not already in methodMap
                        $methods = MethodExtractor::extract($fullPath);
                        CoverageStore::setMethodMap($fullPath, $methods);
                        $existingMethodMap[$fullPath] = $methods; // Update local cache
                    }
                }
            }
        }

        // Extract methods from files that appear in coverage (if not already extracted)
        foreach ($allFiles as $file) {
            if (! file_exists($file)) {
                continue;
            }

            if (! isset($existingMethodMap[$file])) {
                $methods = MethodExtractor::extract($file);
                CoverageStore::setMethodMap($file, $methods);
            }
        }

        // Generate treemap data and output
        $config = Extension::config();
        $outputDirectory = $config->outputDirectory();
        $generator = new TreemapGenerator($outputDirectory);
        $generator->generate();

        echo "\nCoverage Treemap: {$outputDirectory}/index.html\n";
    }
}

