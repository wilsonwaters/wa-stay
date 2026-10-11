/**
 * Setup for the `main` Jest project (testEnvironment: node).
 *
 * Runs as a `setupFiles` entry, i.e. before the test framework and before any test
 * module is loaded, so the values below are seen by modules that read them at import.
 *
 * Deliberately minimal: no global `jest.mock('electron')` and no console silencing.
 * A test that needs Electron APIs mocks `electron` itself, and a test that expects an
 * error to be logged spies on the console locally.
 */

// The Winston logger reads LOG_LEVEL once, at import. Keep info/debug noise out of test
// output while still showing warnings and errors. An explicit LOG_LEVEL wins.
process.env.LOG_LEVEL ??= 'warn';
