<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap\Subscribers;

use PHPUnit\Event\Test\Finished;
use PHPUnit\Event\Test\FinishedSubscriber;
use PHPUnit\Runner\CodeCoverage;

/**
 * Collect coverage data after each test finishes.
 * Note: In PHPUnit 11, we access coverage through the CodeCoverage singleton.
 */
final class CoverageCollected implements FinishedSubscriber
{
    public function notify(Finished $event): void
    {
        $test = $event->test();
        $testId = $test->id();

        $codeCoverage = CodeCoverage::instance();

        if (! $codeCoverage->isActive()) {
            return;
        }

        // Get coverage data for this test
        // Note: PHPUnit collects coverage per test, but we may need to access it differently
        // For now, we'll collect from the final report in TestRunnerFinished
        // This subscriber is a placeholder for future per-test collection if needed
    }
}

