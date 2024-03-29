# Change log

All notable changes to the package will be documented in this file. This project adheres to [Semantic Versioning](http://semver.org).

## [2.2.0] - 2022-04-26
### Added:
- Async helper functions `failOnResolve` and `failOnTimeout`.

### Changed:
- Updated dependency version for `selfsigned` (used when generating certificates for HTTPS testing) to 2.x.

## [2.1.1] - 2021-09-22
The 2.1.0 release was damaged and did not contain source files. 2.1.1 is a rerelease containing the same functionality.

## [2.1.0] - 2021-09-22
### Added:
- You can optionally specify a port for an HTTP server to listen on, instead of letting it automatically pick a port.

### Fixed:
- `TestHttpHandlers.sseStream` was incorrectly writing `event: undefined` if you omitted the event type, instead of completely omitting that line.

## [2.0.0] - 2021-08-23
### Changed:
- Minimum Node version is now 12.
- Updated many dependencies to newer versions.

## [1.3.1] - 2021-07-16
### Fixed:
- Fixed the implementation of `AsyncMutex` which was not behaving as intended when more than two tasks contended for a lock.

## [1.3.0] - 2021-07-07
### Added:
- `AsyncMutex`, a simple async lock implementation for test serialization.

## [1.2.1] - 2021-06-09
### Fixed:
- When generating a self-signed certificate for TLS testing, use a key size of 2048 bits (rather than 1024, the default used by the `selfsigned` module) for maximum cross-platform compatibility.

## [1.2.0] - 2020-04-23
### Added:
- Methods in `TestHttpServer` for creating simple proxy servers.

## [1.1.0] - 2019-12-03
### Added:
- `TestHttpServers`, containing the same static factory methods that are in `TestHttpServer`. This is a workaround for a transpiler problem that can prevent imports from working correctly for classes that have a constructor as well as static methods.

## [1.0.0] - 2019-11-26
Initial release.
