<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap;

use CoverageTreemap\CoverageTreemap\Subscribers\CoverageCollected;
use CoverageTreemap\CoverageTreemap\Subscribers\TestFinished;
use CoverageTreemap\CoverageTreemap\Subscribers\TestRunnerFinished;
use PHPUnit\Runner\Extension\Extension as PHPUnitExtension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

final class Extension implements PHPUnitExtension
{
    private static Config|null $config = null;

    public function bootstrap(
        Configuration $configuration,
        Facade $facade,
        ParameterCollection $parameters,
    ): void {
        // Require code coverage collection
        $facade->requireCodeCoverageCollection();

        // Load configuration, passing parameters from phpunit.xml
        self::$config = new Config(null, $parameters);

        $facade->registerSubscriber(new TestFinished);
        $facade->registerSubscriber(new CoverageCollected);
        $facade->registerSubscriber(new TestRunnerFinished);
    }

    public static function config(): Config
    {
        if (self::$config === null) {
            self::$config = new Config;
        }

        return self::$config;
    }
}

