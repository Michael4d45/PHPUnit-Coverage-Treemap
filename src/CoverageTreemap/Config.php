<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap;

/**
 * Configuration for the Coverage Treemap extension.
 */
final class Config
{
    private string $outputDirectory;

    private array $sourceDirectories;

    private array $excludedDirectories;

    private string $defaultNamespace;

    public function __construct(string|null $phpunitXmlPath = null, \PHPUnit\Runner\Extension\ParameterCollection|null $parameters = null)
    {
        $phpunitXmlPath = $phpunitXmlPath ?? $this->findPhpunitXml();
        
        // Read from parameters first (passed from phpunit.xml), then fall back to XML parsing
        $this->outputDirectory = $parameters?->has('outputDirectory') 
            ? $parameters->get('outputDirectory') 
            : $this->readOutputDirectory($phpunitXmlPath);
        
        $this->defaultNamespace = $parameters?->has('defaultNamespace')
            ? $parameters->get('defaultNamespace')
            : $this->readDefaultNamespace($phpunitXmlPath);
        
        $this->sourceDirectories = $this->readSourceDirectories($phpunitXmlPath);
        $this->excludedDirectories = $this->readExcludedDirectories($phpunitXmlPath);
    }

    public function outputDirectory(): string
    {
        return $this->outputDirectory;
    }

    public function sourceDirectories(): array
    {
        return $this->sourceDirectories;
    }

    public function excludedDirectories(): array
    {
        return $this->excludedDirectories;
    }

    public function defaultNamespace(): string
    {
        return $this->defaultNamespace;
    }

    /**
     * Find phpunit.xml in the project root.
     */
    private function findPhpunitXml(): string
    {
        // Start from the extension directory and walk up to find phpunit.xml
        $dir = __DIR__;
        while ($dir !== '/' && $dir !== '') {
            $phpunitXml = $dir . '/phpunit.xml';
            if (file_exists($phpunitXml)) {
                return $phpunitXml;
            }
            $dir = dirname($dir);
        }

        // Fallback: try current working directory
        $cwd = getcwd();
        if ($cwd !== false) {
            $phpunitXml = $cwd . '/phpunit.xml';
            if (file_exists($phpunitXml)) {
                return $phpunitXml;
            }
        }

        // If we can't find it, return a default path
        return 'phpunit.xml';
    }

    /**
     * Read output directory from phpunit.xml.
     */
    private function readOutputDirectory(string $phpunitXmlPath): string
    {
        if (! file_exists($phpunitXmlPath)) {
            return 'build/coverage-treemap';
        }

        $dom = new \DOMDocument;
        if (! @$dom->load($phpunitXmlPath)) {
            return 'build/coverage-treemap';
        }

        $xpath = new \DOMXPath($dom);

        // Register namespaces for XPath queries
        $xpath->registerNamespace('treemap', 'https://github.com/Michael4d45/PHPUnit-Coverage-Treemap');

        // Look for <treemap outputDirectory="..."/> (namespaced or non-namespaced)
        $treemapNodes = $xpath->query('//treemap:treemap[@outputDirectory] | //treemap[@outputDirectory]');
        if ($treemapNodes->length > 0) {
            $outputDir = $treemapNodes->item(0)->getAttribute('outputDirectory');
            if ($outputDir !== '') {
                return $outputDir;
            }
        }

        // Fallback to default
        return 'build/coverage-treemap';
    }

    /**
     * Read source directories from phpunit.xml.
     *
     * @return array<string> Array of directory paths
     */
    private function readSourceDirectories(string $phpunitXmlPath): array
    {
        if (! file_exists($phpunitXmlPath)) {
            return ['app']; // Default fallback
        }

        $dom = new \DOMDocument;
        if (! @$dom->load($phpunitXmlPath)) {
            return ['app']; // Default fallback
        }

        $xpath = new \DOMXPath($dom);
        $directories = [];

        // Read from <source><include><directory>
        $includeNodes = $xpath->query('//source/include/directory');
        foreach ($includeNodes as $node) {
            $dir = trim($node->nodeValue);
            if ($dir !== '') {
                $directories[] = $dir;
            }
        }

        // If no directories found, try <source><directory> (older format)
        if (empty($directories)) {
            $dirNodes = $xpath->query('//source/directory');
            foreach ($dirNodes as $node) {
                $dir = trim($node->nodeValue);
                if ($dir !== '') {
                    $directories[] = $dir;
                }
            }
        }

        return empty($directories) ? ['app'] : $directories;
    }

    /**
     * Read excluded directories from phpunit.xml.
     *
     * @return array<string> Array of directory paths
     */
    private function readExcludedDirectories(string $phpunitXmlPath): array
    {
        if (! file_exists($phpunitXmlPath)) {
            return [];
        }

        $dom = new \DOMDocument;
        if (! @$dom->load($phpunitXmlPath)) {
            return [];
        }

        $xpath = new \DOMXPath($dom);
        $directories = [];

        // Read from <source><exclude><directory>
        $excludeNodes = $xpath->query('//source/exclude/directory');
        foreach ($excludeNodes as $node) {
            $dir = trim($node->nodeValue);
            if ($dir !== '') {
                $directories[] = $dir;
            }
        }

        // Also check for <source><exclude><file> (if needed)
        $excludeFileNodes = $xpath->query('//source/exclude/file');
        foreach ($excludeFileNodes as $node) {
            $file = trim($node->nodeValue);
            if ($file !== '') {
                $directories[] = $file;
            }
        }

        return $directories;
    }

    /**
     * Read default namespace from phpunit.xml treemap config.
     *
     * @return string Default namespace for root files
     */
    private function readDefaultNamespace(string $phpunitXmlPath): string
    {
        if (! file_exists($phpunitXmlPath)) {
            return 'App';
        }

        $dom = new \DOMDocument;
        if (! @$dom->load($phpunitXmlPath)) {
            return 'App';
        }

        $xpath = new \DOMXPath($dom);

        // Register namespaces for XPath queries
        $xpath->registerNamespace('treemap', 'https://github.com/Michael4d45/PHPUnit-Coverage-Treemap');

        // Look for <treemap defaultNamespace="..."/> (namespaced or non-namespaced)
        $treemapNodes = $xpath->query('//treemap:treemap[@defaultNamespace] | //treemap[@defaultNamespace]');
        if ($treemapNodes->length > 0) {
            $defaultNs = $treemapNodes->item(0)->getAttribute('defaultNamespace');
            if ($defaultNs !== '') {
                return $defaultNs;
            }
        }

        // Fallback to 'App' (common default)
        return 'App';
    }
}

