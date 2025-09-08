# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] - 2024-01-15

### Added
- Enhanced session lifecycle management with proper cleanup
- Added `DetachedSession` and `DetachedSessionWithId` types for better type safety
- Improved event handling with proper type definitions for session events
- Better session equality comparison with `equals()` method
- Enhanced frame management and error handling

### Changed
- Improved `session-attached` and `session-detached` event types
- Better error handling for frame evaluation operations
- Enhanced TypeScript definitions for better developer experience

### Fixed
- Fixed event listener management with dynamic max listeners
- Improved error handling for detached sessions

## [0.3.1] - 2024-01-10

### Added
- Auto target attachment support for iframes, workers, and other targets
- Execution context tracking with real-time monitoring
- Enhanced TypeScript definitions for better type safety
- Better error handling and debugging capabilities

### Changed
- Improved SuperJSON integration
- Enhanced function execution with better error handling

## [0.3.0] - 2024-01-01

### Added
- Initial release with core CDP functionality
- SuperJSON integration for complex data serialization
- Function execution and exposure capabilities
- Comprehensive TypeScript support
- Frame management for iframes and multiple execution contexts
- Event handling system for CDP events
- WebContents extension for convenient CDP access

[Unreleased]: https://github.com/ntoskrnl7/electron-cdp-utils/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/ntoskrnl7/electron-cdp-utils/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ntoskrnl7/electron-cdp-utils/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ntoskrnl7/electron-cdp-utils/releases/tag/v0.3.0
