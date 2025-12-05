<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap\Subscribers;

use PHPUnit\Event\Test\Finished;
use PHPUnit\Event\Test\FinishedSubscriber;

final class TestFinished implements FinishedSubscriber
{
    public function notify(Finished $event): void
    {
        // Placeholder for future test tracking if needed
    }
}

