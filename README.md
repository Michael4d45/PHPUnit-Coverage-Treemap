# Coverage Treemap PHPUnit Extension

A PHPUnit extension that generates an interactive squarified treemap visualization of code coverage.

## Installation

```bash
composer require --dev michael4d45/coverage-treemap
```

## Configuration

Add the extension to your `phpunit.xml`:

```xml
<extensions>
    <bootstrap class="CoverageTreemap\CoverageTreemap\Extension">
        <parameter name="outputDirectory" value="reports/coverage-treemap" />
        <parameter name="defaultNamespace" value="App" />
    </bootstrap>
</extensions>
```

The extension automatically reads source directories from your `<source><include>` configuration and excluded directories from `<source><exclude>`.

## Usage

Run PHPUnit with coverage:

```bash
phpunit --coverage
# or
vendor/bin/phpunit --coverage
```

After tests complete, open `reports/coverage-treemap/index.html` in your browser.

## Requirements

- PHP 8.3+
- PHPUnit 11+
- Code coverage driver (PCOV, Xdebug, etc.)

## Features

- Zero external runtime dependencies
- Squarified treemap algorithm
- File and method-level drill-down
- Test-to-line mapping
- Interactive visualization
- Framework-agnostic (works with any PHP project)

