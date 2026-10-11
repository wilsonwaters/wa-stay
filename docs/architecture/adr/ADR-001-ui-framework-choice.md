# ADR-001: UI Framework Choice

> Historical record from October 2025, when the app automated ParkStay campground bookings
> only; it is now WA Stay. The decision (Electron with React) stands.

**Status:** Proposed
**Date:** 2025-10-31
**Decision Makers:** Architecture Team
**Context:** Desktop application for automating WA ParkStay campground bookings

## Context and Problem Statement

We need to choose a UI framework for the desktop booking application that:
- Runs locally on user machines (Windows and Mac)
- Is simple to install and maintain
- Provides a good user experience
- Doesn't require cloud dependencies
- Can integrate with background job scheduling
- Can display notifications to users

## Decision Drivers

- **Ease of Installation**: Users should be able to install with minimal technical knowledge
- **Cross-Platform Support**: Must work on Windows and Mac
- **Development Speed**: Time to implement features
- **Maintenance Burden**: Long-term maintenance and updates
- **User Experience**: Professional, responsive interface
- **System Integration**: Ability to run background tasks, show notifications
- **Distribution**: How easily can updates be distributed
- **Resource Usage**: Memory and CPU footprint

## Options Considered

### Option 1: Electron App with Local Web UI

**Description:** Package a web-based UI (HTML/CSS/JavaScript) with Chromium and Node.js using Electron.

**Pros:**
- Rich ecosystem of UI frameworks (React, Vue, etc.)
- Single codebase for Windows and Mac
- Easy to build modern, responsive interfaces
- Good tooling and debugging support
- Can leverage web technologies for rapid development
- Built-in auto-updater functionality
- Native system tray integration
- Good notification support

**Cons:**
- Large bundle size (150-200MB+)
- Higher memory footprint (Chromium overhead)
- Perceived as "bloated" by some users
- Longer initial startup time
- Security concerns if not properly configured

**Technology Stack:**
- Electron 28+
- React or Vue for UI
- Node.js backend
- SQLite for local storage
- node-cron for job scheduling (since replaced by chained timers)

**Installation:**
- Single installer/DMG file per platform
- No dependencies needed
- Auto-update capability built-in

### Option 2: Native Desktop App

**Description:** Build native applications using platform-specific frameworks.

**Pros:**
- Best performance and resource efficiency
- Smallest bundle size
- Native look and feel per platform
- Direct OS integration
- Fastest startup time
- No web runtime overhead

**Cons:**
- Separate codebases for Windows and Mac
- 2x development and maintenance effort
- Requires platform-specific expertise
- Slower development velocity
- More complex build and release process
- Different UI/UX per platform

**Technology Stack (Windows):**
- C# with WPF or WinUI 3
- .NET 8+
- SQLite
- Quartz.NET for scheduling

**Technology Stack (Mac):**
- Swift with SwiftUI
- SQLite
- Combine framework

**Installation:**
- Windows: MSI installer
- Mac: DMG with code signing
- Manual updates or custom update mechanism

### Option 3: Simple Web Server with Desktop Launcher

**Description:** Python/Node.js web server that launches automatically with a desktop shortcut, opens in default browser.

**Pros:**
- Very simple architecture
- Smallest development effort
- Easy to debug and maintain
- Works on any platform with Python/Node
- Small bundle size (50-100MB)
- Can use modern web frameworks

**Cons:**
- Poor user experience (opens in browser)
- No native look and feel
- Limited system integration (notifications, tray icons)
- Port conflicts possible
- Looks less "professional"
- Browser compatibility issues
- Harder to auto-update
- Users might accidentally close browser tab

**Technology Stack:**
- Python (FastAPI) or Node.js (Express)
- React/Vue frontend
- SQLite
- APScheduler or node-cron
- Desktop launcher scripts

**Installation:**
- Python/Node.js runtime required (or bundled with PyInstaller/pkg)
- Less polished installation experience
- Manual browser launching

## Decision Outcome

**Chosen Option: Option 1 - Electron App with Local Web UI**

### Rationale

After evaluating all options against our decision drivers, Electron provides the best balance of:

1. **Developer Productivity**: Single codebase, rapid development with modern web frameworks
2. **User Experience**: Professional desktop application feel with native integrations
3. **Cross-Platform**: True write-once, run-anywhere with consistent UX
4. **Installation**: Simple one-click installers with auto-update capability
5. **Ecosystem**: Rich library ecosystem for all needed features

While Electron has higher resource usage, modern hardware makes this acceptable for a desktop productivity tool. The development speed and maintenance benefits outweigh the resource costs.

### Implementation Strategy

**Framework Choices:**
- **Electron** 28+ (latest stable)
- **React 18** for UI (component reusability, large ecosystem)
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Electron Builder** for packaging and distribution
- **SQLite** (better-sqlite3) for local database
- **node-cron** for job scheduling (since replaced by chained timers)
- **Electron Store** for configuration

**Architecture Pattern:**
- Main process: Node.js backend, database, job scheduler
- Renderer process: React UI
- IPC communication between processes
- Preload scripts for secure API exposure

### Positive Consequences

- Fast development cycles
- Modern, responsive UI
- Easy to add features (notifications, system tray, auto-updates)
- Good debugging tools (Chrome DevTools)
- Active community and support
- Simple CI/CD for builds

### Negative Consequences

- 150-200MB download size
- 100-150MB RAM baseline usage
- Chromium security updates needed
- Slightly slower startup vs native

### Mitigation Strategies

**For Bundle Size:**
- Use electron-builder compression
- Exclude unnecessary dependencies
- Lazy load features

**For Memory Usage:**
- Single window architecture
- Efficient React patterns (memoization, virtualization)
- Periodic cleanup of background tasks

**For Security:**
- Enable context isolation
- Disable Node integration in renderer
- Use preload scripts for IPC
- Keep Electron updated
- Validate all IPC messages

## Links and References

- [Electron Documentation](https://www.electronjs.org/docs/latest)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [VS Code Architecture](https://code.visualstudio.com/docs/supporting/ux-guidelines) (successful Electron app)
- [Electron Builder](https://www.electron.build/)

## Alternatives Considered for Future

If Electron proves problematic, we could consider:
- **Tauri** (Rust + Web): Lighter alternative, uses system webview
- **Flutter Desktop**: Single codebase, native compilation
- **Progressive Web App (PWA)**: If browser-based becomes acceptable

These would require significant refactoring but remain possible migration paths.
