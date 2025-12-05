<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap;

/**
 * In-memory store for coverage data.
 *
 * Structure:
 * - testCoverage: test_id => [file => [line => hit_count]]
 * - coverableLines: file => [line_numbers]
 * - methodMap: file => [method_name => [start_line, end_line]]
 */
final class CoverageStore
{
    /**
     * @var array<string, array<string, array<int, int>>>
     */
    private static array $testCoverage = [];

    /**
     * @var array<string, array<int>>
     */
    private static array $coverableLines = [];

    /**
     * @var array<string, array<string, array{0: int, 1: int}>>
     */
    private static array $methodMap = [];

    /**
     * Add coverage data for a specific test.
     *
     * @param  array<string, array<int, int>>  $lines  File => Line => Hit count
     */
    public static function addTestCoverage(string $testId, array $lines): void
    {
        self::$testCoverage[$testId] = $lines;
    }

    /**
     * Set coverable lines for files.
     *
     * @param  array<string, array<int>>  $coverableLines  File => Line numbers
     */
    public static function setCoverableLines(array $coverableLines): void
    {
        self::$coverableLines = $coverableLines;
    }

    /**
     * Set method map for a file.
     *
     * @param  array<string, array{0: int, 1: int}>  $methods  Method name => [start_line, end_line]
     */
    public static function setMethodMap(string $file, array $methods): void
    {
        self::$methodMap[$file] = $methods;
    }

    /**
     * Get all test coverage data.
     *
     * @return array<string, array<string, array<int, int>>>
     */
    public static function getTestCoverage(): array
    {
        return self::$testCoverage;
    }

    /**
     * Get coverable lines for all files.
     *
     * @return array<string, array<int>>
     */
    public static function getCoverableLines(): array
    {
        return self::$coverableLines;
    }

    /**
     * Get method map for all files.
     *
     * @return array<string, array<string, array{0: int, 1: int}>>
     */
    public static function getMethodMap(): array
    {
        return self::$methodMap;
    }

    /**
     * Clear all stored data.
     */
    public static function clear(): void
    {
        self::$testCoverage = [];
        self::$coverableLines = [];
        self::$methodMap = [];
    }
}

