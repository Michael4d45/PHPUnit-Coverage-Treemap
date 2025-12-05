<?php

declare(strict_types=1);

namespace CoverageTreemap\CoverageTreemap;

/**
 * Extract method information from PHP files using token_get_all().
 */
final class MethodExtractor
{
    /**
     * Extract methods from a PHP file.
     *
     * @param  string  $file  Path to PHP file
     * @return array<string, array{0: int, 1: int}> Method name => [start_line, end_line]
     */
    public static function extract(string $file): array
    {
        if (! file_exists($file)) {
            return [];
        }

        $content = file_get_contents($file);
        if ($content === false) {
            return [];
        }

        $tokens = token_get_all($content);
        $methods = [];
        $currentClass = null;
        $currentMethod = null;
        $methodStartLine = null;
        $braceDepth = 0;
        $inMethod = false;
        $currentLine = 1; // Track current line number
        $i = 0;

        while ($i < count($tokens)) {
            $token = $tokens[$i];

            if (is_string($token)) {
                if ($token === '{') {
                    $braceDepth++;
                    if ($inMethod && $braceDepth === 1) {
                        // Method body started
                    }
                } elseif ($token === '}') {
                    $braceDepth--;
                    if ($inMethod && $braceDepth === 0) {
                        // Method ended - try to get line number from next token or use current line
                        $endLine = $currentLine;
                        // Look ahead to next token to get more accurate line number
                        if ($i + 1 < count($tokens)) {
                            $nextToken = $tokens[$i + 1];
                            if (is_array($nextToken) && isset($nextToken[2])) {
                                // Use the line number from the next token (which is after the closing brace)
                                // Subtract 1 to get the line of the closing brace itself
                                $endLine = max($currentLine, $nextToken[2] - 1);
                            }
                        }
                        if ($currentMethod !== null && $methodStartLine !== null) {
                            $methods[$currentMethod] = [$methodStartLine, $endLine];
                        }
                        $inMethod = false;
                        $currentMethod = null;
                        $methodStartLine = null;
                    }
                }
                $i++;

                continue;
            }

            [$tokenType, $tokenValue, $line] = $token;
            $currentLine = $line; // Update current line number

            // Track class context
            if ($tokenType === T_CLASS || $tokenType === T_INTERFACE || $tokenType === T_TRAIT) {
                $i++;
                // Skip to class name
                while ($i < count($tokens) && is_array($tokens[$i]) && $tokens[$i][0] === T_WHITESPACE) {
                    $i++;
                }
                if ($i < count($tokens) && is_array($tokens[$i]) && $tokens[$i][0] === T_STRING) {
                    $currentClass = $tokens[$i][1];
                }
            }

            // Detect function/method
            if ($tokenType === T_FUNCTION) {
                $i++;
                // Skip whitespace
                while ($i < count($tokens) && is_array($tokens[$i]) && $tokens[$i][0] === T_WHITESPACE) {
                    $i++;
                }
                // Check if it's a method (has & or name)
                if ($i < count($tokens)) {
                    $nextToken = $tokens[$i];
                    if (is_array($nextToken)) {
                        if ($nextToken[0] === T_STRING) {
                            $methodName = $nextToken[1];
                            $methodStartLine = $nextToken[2];
                            $currentMethod = ($currentClass !== null ? $currentClass . '::' : '') . $methodName;
                            $inMethod = true;
                            $braceDepth = 0;
                        } elseif ($nextToken[0] === '&') {
                            // Reference return
                            $i++;
                            while ($i < count($tokens) && is_array($tokens[$i]) && $tokens[$i][0] === T_WHITESPACE) {
                                $i++;
                            }
                            if ($i < count($tokens) && is_array($tokens[$i]) && $tokens[$i][0] === T_STRING) {
                                $methodName = $tokens[$i][1];
                                $methodStartLine = $tokens[$i][2];
                                $currentMethod = ($currentClass !== null ? $currentClass . '::' : '') . $methodName;
                                $inMethod = true;
                                $braceDepth = 0;
                            }
                        }
                    }
                }
            }

            $i++;
        }

        return $methods;
    }
}

