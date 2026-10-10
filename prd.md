# PRD — Spazio Native POS
## React Native Hybrid POS with Offline-First Printing

**Document type:** Product Requirements Document + Technical Implementation Specification  
**Product:** Spazio Native POS  
**Platforms:** Android and iOS  
**Primary stack:** React Native, TypeScript, WebView, native printer integrations  
**Existing application:** Next.js Spazio PWA hosted in the cloud  
**Primary objective:** Enable reliable thermal printing over Ethernet LAN without requiring the browser to communicate directly with printer TCP sockets.

---

# 1. Product Overview

## 1.1 Background

Spazio currently operates as a Next.js web application hosted in the cloud and installed on cashier tablets as a Progressive Web App (PWA).

The current web architecture has limitations when communicating directly with thermal printers, particularly printers that expose ESC/POS over TCP/IP, commonly using port `9100`.

The project will introduce a React Native application that acts as the native POS container, device integration layer, and offline-capable printing system.

The application will use a hybrid architecture:

- Existing Next.js pages remain responsible for the existing POS interface and business logic where practical.
- React Native provides native screens for printer configuration, connection diagnostics, offline status, and device-specific capabilities.
- A native printing subsystem handles ESC/POS commands, connection management, print queues, and printing status.
- A local data subsystem stores permitted operational data and pending transactions for offline use.
- A synchronization subsystem reconciles locally stored data with the existing Spazio backend.

## 1.2 Product vision

Create a reliable native POS application that allows restaurant cashiers to:

1. Continue using the existing Spazio interface.
2. Print receipts and kitchen tickets directly to compatible thermal printers.
3. Connect to Ethernet, Bluetooth, and USB printers where supported.
4. Continue supported cashier operations during internet outages.
5. Configure printers without editing application source code.
6. Recover from printer failures without accidentally duplicating receipts or orders.
7. Use the same product architecture on Android and iOS, with platform-specific implementations where necessary.

## 1.3 Primary users

- Restaurant cashiers.
- Restaurant owners and outlet administrators.
- Kitchen staff receiving printed order tickets.
- Technical support personnel configuring printers and diagnosing failures.

## 1.4 Success criteria

The application is considered successful when:

- An existing Spazio user can log in through the native application.
- A compatible LAN printer can be configured using its IP address and port.
- A cashier can print customer receipts and kitchen tickets without opening the browser print dialog.
- A supported offline workflow can create and persist local orders.
- Printing continues locally when internet connectivity is unavailable.
- Pending transactions can be synchronized when the backend becomes reachable.
- Failed print jobs are visible and recoverable.
- Android and iOS builds have documented, tested capability matrices.

---

# 2. Scope

## 2.1 In scope

- React Native application setup using TypeScript.
- Hybrid application architecture using WebView.
- Native React Native settings and printer-management screens.
- Secure JavaScript-to-native communication.
- ESC/POS printing over TCP/IP.
- Printer abstraction supporting LAN, Bluetooth, and USB.
- Manual printer configuration.
- Printer connection testing.
- Multiple printers and configurable print destinations.
- Receipt and kitchen ticket printing.
- Persistent print queue.
- Print job tracking and manual retry.
- Local storage for supported offline operations.
- Offline order queue and backend synchronization.
- Network monitoring and reconnection.
- Platform-specific permissions.
- Automated and manual testing.
- Android APK generation and iOS build configuration.
- Setup and maintenance documentation.

## 2.2 Out of scope for the initial implementation

Unless the existing repository or product owner explicitly requires otherwise:

- Rebuilding the entire POS interface in React Native.
- Replacing the existing Next.js backend or database.
- Introducing a new cloud printing SaaS.
- Exposing printer ports to the public internet.
- Automatically discovering printers on the LAN.
- Guaranteeing physical printing based solely on a successful TCP write.
- Changing existing pricing, tax, payment, inventory, or order business rules.
- Implementing offline payment processing that requires online authorization.
- Claiming universal USB, Bluetooth, or ESC/POS compatibility across all printer models.

## 2.3 Priority definitions

- **P0 — Must have:** Required for the first usable release.
- **P1 — Should have:** Required for a production-ready rollout or the relevant platform.
- **P2 — Future:** Can be implemented after the initial stable release.

---

# 3. Architecture

## 3.1 High-level architecture

```text
                 SPazio Cloud
          Existing Next.js Application
             Existing Backend APIs
                       |
                 HTTPS / API
                       |
        +-----------------------------+
        |   Spazio Native POS         |
        |   React Native + TypeScript |
        |                             |
        |  +-----------------------+  |
        |  | Existing Next.js UI   |  |
        |  | inside WebView        |  |
        |  +-----------------------+  |
        |              |              |
        |        Secure Bridge        |
        |              |              |
        |  +-----------------------+  |
        |  | Native Print Manager  |  |
        |  +-----------------------+  |
        |       |       |       |      |
        |      LAN   Bluetooth  USB    |
        |                             |
        |  +-----------------------+  |
        |  | Local Storage         |  |
        |  | Offline Order Queue   |  |
        |  | Sync Engine            |  |
        |  +-----------------------+  |
        +-----------------------------+
                       |
                 Local Network
                       |
              Thermal Printers
```

## 3.2 Architectural principles

1. Keep existing business rules in the current application and backend wherever possible.
2. Use native code only for capabilities that require device access.
3. Do not duplicate business logic unnecessarily between Next.js and React Native.
4. Use a platform-independent printer interface with separate transport implementations.
5. Persist important local operations before acknowledging that they have been saved.
6. Separate transaction synchronization from physical print-job execution.
7. Treat printing as an at-least-once delivery problem with duplicate-risk controls, not as a transaction that can guarantee exactly-once physical output.
8. Avoid hardcoding printer IP addresses, ports, or outlet configurations.
9. Never expose the native bridge to arbitrary web pages.
10. Preserve backward compatibility with existing Spazio API contracts.

## 3.3 Technology stack

The coding agent must evaluate and document compatible package versions before implementation.

| Layer | Preferred technology |
|---|---|
| Mobile framework | React Native + TypeScript |
| Navigation | React Navigation or Expo Router, selected after repository inspection |
| Existing web interface | React Native WebView |
| Local database | SQLite with transactional writes |
| Small settings and credentials | Platform-secure storage |
| Network printing | TCP socket implementation with ESC/POS byte output |
| Bluetooth | Platform-compatible native module or vendor SDK |
| USB | Android USB Host implementation or compatible native module |
| Offline synchronization | Persistent outbox + idempotent backend synchronization |
| Testing | Jest, React Native Testing Library, integration tests, device tests |
| Android build | Gradle |
| iOS build | Xcode |

The coding agent must not assume a particular printer library is compatible with every platform. Review its maintenance status, native dependencies, licensing, and support for the intended React Native version.

Expo may be used only if the selected development and build workflow supports the required native networking and printer integrations. Do not use Expo Go as the production compatibility target for custom native modules.

---

# 4. Application Experience

## 4.1 Application launch

On startup, the application must:

1. Initialize local storage.
2. Load saved printer configuration.
3. Restore pending print jobs and offline transactions.
4. Determine network availability without relying exclusively on a network-status indicator.
5. Display a native loading screen.
6. Open the existing Spazio Next.js application inside WebView.
7. Expose native printing only after the trusted application origin and bridge are initialized.
8. Display a clear offline indicator when the cloud backend is unavailable.

If the web interface cannot load, the application must display an offline screen or supported local cashier interface rather than a blank WebView.

The agent must determine whether the existing Next.js application already supports local caching and offline navigation. If not, implement a documented offline UI strategy without claiming that an uncached remote application can operate fully offline.

## 4.2 Native screens

The first release must include the following native screens.

### A. Device status

Display:

- Application version.
- Online/offline status.
- Backend connectivity status.
- Current outlet or terminal identifier.
- Configured printer count.
- Pending print-job count.
- Pending synchronization count.
- Last successful synchronization time.
- Access to printer settings.

### B. Printer settings

Allow authorized users to:

- Add a printer manually.
- Edit printer details.
- Enable or disable a printer.
- Delete a printer after confirmation.
- Select a connection type.
- Enter an IP address and port for LAN printers.
- Assign a printer name.
- Assign supported print destinations.
- Set a default printer for each destination.
- Run a connection test.
- Print a test receipt.
- View printer status and recent failures.

Configuration must be stored persistently and restored after application restart.

### C. Printer diagnostics

Show:

- Connection type.
- Configured address and port, where applicable.
- Last connection attempt.
- Last successful communication.
- Last known printer error.
- Pending and failed print jobs.
- A manual retry action.
- Instructions for checking the printer, power, network, paper, and connection.

A successful TCP connection must not be displayed as proof that paper was physically printed.

---

# 5. Printer Requirements

## 5.1 Printer abstraction

Define a common interface similar to:

```typescript
type PrinterConnectionType =
  | "lan"
  | "bluetooth"
  | "usb";

type PrintDestination =
  | "customer_receipt"
  | "kitchen_ticket";

interface PrinterConfig {
  id: string;
  name: string;
  connectionType: PrinterConnectionType;
  host?: string;
  port?: number;
  enabled: boolean;
  destinations: PrintDestination[];
  paperWidthMm?: 58 | 80;
}

interface PrinterDriver {
  connect(config: PrinterConfig): Promise<void>;
  disconnect(printerId: string): Promise<void>;
  testConnection(printerId: string): Promise<ConnectionTestResult>;
  print(printerId: string, job: PrintJob): Promise<PrintResult>;
}
```

The final interfaces may differ, but the separation between printer configuration, transport, job management, and ESC/POS formatting is mandatory.

Each transport implementation must provide consistent error reporting and connection semantics.

## 5.2 LAN printing — P0

LAN printing is the primary printing method.

Requirements:

- Accept manually configured IPv4 addresses.
- Support a configurable TCP port.
- Use `9100` as the default only when appropriate for the selected printer.
- Allow changing the port.
- Validate addresses and ports.
- Open a TCP connection to the configured printer.
- Send correctly encoded ESC/POS bytes.
- Close connections reliably after each job unless a documented connection-pooling strategy is used.
- Handle connection refusal, timeout, connection reset, unreachable host, and write failures.
- Support multiple configured printers.
- Support printing to multiple destinations in one user action.
- Prevent unrestricted access to arbitrary IP addresses through untrusted WebView messages.
- Keep the UI responsive while printing.

The implementation must not assume that every printer supports the same ESC/POS commands.

## 5.3 Bluetooth printing — P1

Provide a separate Bluetooth driver.

The agent must document:

- Supported Bluetooth profiles and printer models.
- Required Android runtime permissions.
- Pairing and device selection.
- Connection and disconnection handling.
- Platform limitations on iOS.
- Whether Bluetooth Classic, BLE, or a vendor-specific protocol is supported.

A generic Bluetooth library must not be assumed to support all thermal printers.

## 5.4 USB printing — P1

Provide a separate USB driver where supported.

For Android:

- Use Android USB Host APIs or a compatible native module.
- Request user permission for USB device access.
- Handle device detach and reconnect.
- Handle USB write errors.
- Document supported USB interfaces and device compatibility.

For iOS:

- Do not promise generic USB ESC/POS printing unless the hardware, connection path, and supported iOS APIs have been verified.

## 5.5 Printer compatibility matrix

Maintain a compatibility matrix in the project documentation.

| Capability | Android | iOS |
|---|---|---|
| LAN ESC/POS over TCP | P0 | P1, subject to testing |
| Bluetooth | P1 | P1, subject to protocol and accessory support |
| USB | P1 | Model/accessory-specific |
| Multiple printers | P0 | P1 |
| Automatic discovery | Out of scope | Out of scope |
| Manual IP configuration | P0 | P1 |
| Receipt and kitchen destinations | P0 | P1 |

A feature must be marked supported only after validation on actual hardware.

---

# 6. Printing and Receipt Workflow

## 6.1 Print destinations

The application must support at least two configurable destinations:

1. Customer receipt.
2. Kitchen ticket.

Each destination may have one or more printers assigned.

The system must allow a single user action to dispatch separate print jobs to multiple configured printers.

Example:

- Customer receipt → cashier printer.
- Kitchen ticket → kitchen printer.
- Additional kitchen printer → optional duplicate destination for a separate station.

The same order may generate multiple distinct jobs. Each job must have its own unique identifier and destination.

## 6.2 Print workflow

1. A cashier triggers printing from the existing Next.js interface.
2. The web interface generates a print request using an approved contract.
3. The native bridge validates the request.
4. The native Print Manager resolves the destination and printer configuration.
5. The Print Manager persists the job in the local database.
6. The job enters the pending queue.
7. The appropriate printer driver establishes the connection.
8. The ESC/POS renderer generates printer-specific bytes.
9. The driver sends the job to the printer.
10. The application records the transport result.
11. The UI displays the resulting status.
12. If the operation fails, the job remains available for manual recovery.

The UI must not claim that the paper was physically printed simply because the request was accepted or bytes were sent.

## 6.3 Print-job states

Implement an explicit state machine.

- `queued`
- `connecting`
- `sending`
- `submitted`
- `failed`
- `unknown`
- `cancelled`

A separate physical confirmation status may be used when supported by the printer.

State definitions:

- `queued`: persisted locally and waiting for processing.
- `connecting`: attempting to establish a connection.
- `sending`: transmitting bytes.
- `submitted`: data transmission completed according to the available transport signal.
- `failed`: a failure occurred before successful submission could be established.
- `unknown`: the result is ambiguous, such as a connection loss after some bytes were transmitted.
- `cancelled`: the job was cancelled before transmission began.

An `unknown` job must never be silently reprinted. It requires an explicit recovery decision.

## 6.4 Duplicate prevention

Implement:

- Unique print-job IDs.
- A unique business operation ID where available.
- A stable destination ID.
- Persistent job state.
- Duplicate request detection within a configurable retention period.
- Explicit manual retry.
- Warnings when a job with an ambiguous outcome is retried.

The system must distinguish between duplicate network requests and intentionally requested duplicate receipts.

Exactly-once physical printing cannot be guaranteed for generic ESC/POS printers because the application may lose connectivity after the printer receives data but before the application confirms delivery.

## 6.5 ESC/POS rendering

Create a dedicated renderer that supports:

- Text encoding appropriate to the printer.
- Alignment.
- Bold and normal text.
- Line spacing.
- Receipt separators.
- Item names and quantities.
- Prices and totals supplied by the existing business logic.
- Optional QR codes or barcodes when supported.
- Feed and cut commands when supported by the printer.
- Paper-width-specific formatting for 58 mm and 80 mm printers.

Formatting must be separated from networking.

Do not embed all ESC/POS byte sequences directly inside UI components.

## 6.6 Test printing

The application must provide:

- A connection test.
- A test receipt.
- A result indicating whether a connection was established.
- A result indicating whether data transmission completed.
- A clear explanation that physical printing may still fail due to paper, hardware, or printer-state issues.

Where supported, printer status queries may provide additional information. Such queries must not be assumed to work on all devices.

---

# 7. Hybrid WebView and Native Bridge

## 7.1 Responsibilities

The WebView remains responsible for the existing web UI.

React Native owns:

- Printer settings.
- Device-specific permissions.
- Local persistence.
- Native printing.
- Local print queues.
- Offline data handling.
- Synchronization coordination.
- Native diagnostics.

The agent must inspect the existing Next.js repository and determine which print-related functions currently exist. Reuse existing business data and formatting where appropriate without making the web application depend on native APIs when running in a normal browser.

## 7.2 Bridge contract

Implement a versioned bridge with request IDs.

Example request:

```json
{
  "version": 1,
  "type": "PRINT_REQUEST",
  "requestId": "req-unique-id",
  "payload": {
    "orderId": "order-id",
    "destination": "customer_receipt"
  }
}
```

Example response:

```json
{
  "version": 1,
  "type": "PRINT_RESULT",
  "requestId": "req-unique-id",
  "payload": {
    "jobId": "print-job-id",
    "status": "queued"
  }
}
```

The examples are protocol illustrations, not fixed business schemas. The agent must adapt them to the existing Spazio order model.

The bridge must support:

- Request validation.
- Version validation.
- Request correlation.
- Explicit success and error responses.
- Timeouts.
- Duplicate request detection.
- Native job-status events or polling.
- Backward-compatible contract evolution.

Do not return success to the web layer until the request has been validated and its intended persistence or execution stage has been reached.

## 7.3 Bridge security

The bridge must:

- Be available only to the trusted Spazio origin.
- Validate the loaded URL and every navigation.
- Reject unexpected schemes and untrusted hosts.
- Restrict navigation to explicitly approved origins.
- Validate message types, sizes, fields, and permitted operations.
- Never execute arbitrary JavaScript received from the page.
- Never accept arbitrary shell commands or arbitrary native method names.
- Prevent untrusted web content from triggering arbitrary LAN connections.
- Avoid exposing credentials, session tokens, or sensitive order data in logs.
- Handle bridge initialization and teardown safely.
- Avoid exposing privileged bridge methods to third-party pages, external links, or embedded untrusted content.

When opening an external URL, use the operating system browser or another controlled flow without exposing the privileged bridge.

## 7.4 Web compatibility

The Next.js application must continue to function as a normal browser/PWA application.

If the native bridge is unavailable:

- Native-specific features must be marked unavailable.
- Existing browser printing may remain available as a fallback.
- The web application must not crash because `window.AndroidPrinter` or an equivalent native object is missing.
- The application must not claim that a browser print request has been physically completed.

---

# 8. Offline-First Requirements

## 8.1 Offline definition

Offline mode means that supported local cashier operations can continue when the cloud backend or internet connection is unavailable.

Offline mode does not automatically imply that all existing Spazio features will work offline.

Before implementing offline transactions, the agent must inspect the current business rules and APIs and document which operations can be performed safely without the backend.

## 8.2 Required offline behavior

P0 requirements:

- Detect backend unavailability.
- Display offline status.
- Preserve locally created, supported orders.
- Persist pending order operations.
- Print supported receipts and kitchen tickets using locally available data.
- Maintain print jobs when the internet is unavailable.
- Restore pending jobs after application restart.
- Preserve queued operations until they are synchronized or explicitly resolved.
- Prevent accidental deletion of unsynchronized data.
- Synchronize pending operations when connectivity returns.
- Display synchronization status and errors.

The application must not rely solely on an in-memory queue.

## 8.3 Local database

Use a transactional local database, preferably SQLite.

Minimum entities:

### `local_orders`

- `local_id`
- `server_order_id`, nullable
- `outlet_id`
- `status`
- `payload`
- `created_at`
- `updated_at`
- `sync_status`
- `last_sync_error`

### `print_jobs`

- `id`
- `order_id`
- `destination`
- `printer_id`
- `status`
- `payload`
- `attempt_count`
- `created_at`
- `updated_at`
- `last_error`
- `idempotency_key`

### `printers`

- `id`
- `name`
- `connection_type`
- `host`, nullable
- `port`, nullable
- `enabled`
- `destinations`
- `paper_width`
- `created_at`
- `updated_at`

### `sync_outbox`

- `id`
- `operation_type`
- `entity_id`
- `payload`
- `idempotency_key`
- `status`
- `attempt_count`
- `created_at`
- `last_error`

The agent may refine the schema after inspecting the existing domain model. Schema migrations and crash recovery are required.

## 8.4 Offline business rules

The agent must not invent rules for stock, discounts, taxes, payment status, order numbering, or financial settlement.

Before implementing offline order creation:

1. Inspect existing order and payment APIs.
2. Identify required server-side validation.
3. Identify which data can be cached safely.
4. Determine how local IDs map to server IDs.
5. Determine how inventory conflicts are reconciled.
6. Determine whether cash sales can be recorded locally.
7. Define behavior for duplicate synchronization requests.
8. Document conflicts requiring user intervention.

Operations that require an online authorization must remain unavailable offline unless the existing business explicitly supports a safe offline alternative.

For example, an online payment must not be marked paid merely because a local order has been stored.

## 8.5 Synchronization

The sync engine must:

- Use a persistent outbox.
- Retry transient network failures.
- Use exponential backoff with jitter for background synchronization.
- Support server-side idempotency where available.
- Avoid overwriting newer server data without a documented conflict strategy.
- Preserve locally queued data on application termination.
- Record success, failure, and conflict states.
- Resume synchronization after app restart.
- Expose synchronization results to the UI.

If the existing backend does not support idempotency or offline order reconciliation, the agent must document the required API changes rather than simulating server guarantees locally.

---

# 9. Network and Connection Management

## 9.1 LAN requirements

- Tablet and printer must be on mutually reachable networks.
- Printer addresses must be configurable.
- Connection attempts must have bounded timeouts.
- Connections must be released after failure.
- A printer becoming unavailable must not freeze the application.
- Multiple jobs for the same printer must be serialized unless the device protocol safely supports another approach.
- Separate printers may process independent jobs concurrently.
- Network changes must invalidate stale connections.
- The app must recover from Wi-Fi disconnection and reconnection.

## 9.2 Network security

- Never expose printer TCP ports to the public internet.
- Do not assume that a private IP address alone is sufficient authorization.
- Validate and restrict configured addresses according to deployment requirements.
- Protect the printer configuration UI with appropriate user permissions.
- Do not let an untrusted WebView message specify an unrestricted IP address and port.
- Consider outlet and VLAN segmentation for production deployments.
- Avoid logging full receipt payloads unless explicitly necessary for diagnostics and appropriately protected.

## 9.3 Printer connection lifecycle

Each driver must support:

- Initialize.
- Connect.
- Send.
- Disconnect.
- Handle timeout.
- Handle transport failure.
- Reconnect on a new job.
- Clean up resources on app lifecycle changes.

The initial implementation should prefer short-lived connections per job unless actual hardware testing demonstrates that persistent connections are reliable and beneficial.

---

# 10. Error Handling and Manual Recovery

## 10.1 Error categories

The application must distinguish:

- Invalid printer configuration.
- Permission denied.
- Printer unreachable.
- Connection timeout.
- Connection refused.
- Connection lost during transmission.
- Invalid ESC/POS payload.
- Unsupported printer command.
- Printer busy or unavailable, when detectable.
- Out of paper, when detectable.
- Local database failure.
- Bridge validation failure.
- Offline synchronization failure.
- Server-side conflict.

## 10.2 Error UI

Each failed or ambiguous job must show:

- Order reference.
- Destination.
- Printer name.
- Error category.
- Time of failure.
- Whether transmission began.
- Available recovery action.

Provide manual actions such as:

- Test connection.
- Retry job.
- Select another printer.
- Reprint intentionally.
- Mark as reviewed.
- Cancel a job that has not started.

Do not silently discard failed jobs.

Do not automatically reprint an ambiguous job because it may already have printed.

## 10.3 Retry policy

For the initial release:

- No automatic physical print retries after an ambiguous transmission.
- Allow manual retry with a warning when duplicate output is possible.
- Retry safe connection establishment where no print data has been transmitted.
- Keep retry attempts and results in the local database.
- Use exponential backoff for synchronization, not indiscriminate print-job resubmission.

---

# 11. Security and Privacy

The application must:

- Store authentication credentials using platform-secure storage.
- Avoid storing long-lived secrets in JavaScript-readable local storage.
- Follow existing Spazio authentication and authorization rules.
- Respect session expiration and logout.
- Validate the trusted WebView origin before enabling native functionality.
- Validate all bridge messages.
- Use HTTPS for cloud API communication.
- Protect sensitive local database contents as appropriate to the data and threat model.
- Avoid logging passwords, tokens, payment credentials, or complete sensitive receipt contents.
- Clear appropriate user-specific local data during logout without deleting unresolved operational records silently.
- Define secure behavior for shared cashier tablets and outlet switching.
- Prevent one outlet's pending orders from being synchronized under another outlet's identity.

A locally stored order must not be considered authorized for server-side settlement until the backend validates it.

---

# 12. User Interface and Experience Requirements

## 12.1 WebView integration

The existing Next.js UI must remain the primary cashier interface.

The agent must:

- Preserve existing navigation and user workflows.
- Reuse existing authentication flows when compatible.
- Handle keyboard and viewport resizing.
- Handle external links safely.
- Provide native back-button behavior on Android.
- Display a clear loading and error state.
- Handle session expiration.
- Ensure print actions do not freeze the UI.
- Avoid unnecessary duplicate web and native screens.

## 12.2 Native settings interface

The native UI must use consistent naming and understandable error messages.

Required settings:

- Printer list.
- Add printer.
- Edit printer.
- Connection type.
- IP address.
- Port.
- Paper width.
- Destination assignment.
- Default printer.
- Connection test.
- Test print.
- Enable/disable printer.
- Print-job history.
- Offline and sync status.

## 12.3 Accessibility and usability

- Use readable typography and sufficient contrast.
- Make important controls accessible to touch.
- Prevent accidental deletion of printer configuration.
- Clearly distinguish offline status, printer connectivity, and print-job status.
- Do not represent a printer as healthy based only on a previously successful connection.
- Display errors in language suitable for cashier operations.

Indonesian should be the initial UI language unless the existing Spazio application specifies another localization strategy.

---

# 13. Backend and Existing Application Integration

## 13.1 Repository inspection

Before implementation, the agent must inspect:

- Existing Next.js repository structure.
- Authentication mechanism.
- API endpoints.
- Order schema and lifecycle.
- Receipt and kitchen ticket rendering.
- Existing print buttons and print helpers.
- Outlet and terminal identification.
- Payment flows.
- Existing offline/PWA caching.
- Current deployment and environment configuration.

The agent must produce a short integration map before making significant changes.

## 13.2 API compatibility

The application must reuse existing API contracts where possible.

Do not invent endpoints and assume they exist.

If new API functionality is required, document:

- Endpoint and method.
- Authentication requirements.
- Request and response schemas.
- Idempotency behavior.
- Validation rules.
- Error responses.
- Offline reconciliation behavior.

Backend changes must be separately identified from mobile-only changes.

## 13.3 Receipt data

The native print engine must receive validated order data or a stable receipt representation.

Financial values must come from the authoritative business calculation rather than being independently recalculated by the native UI.

The receipt renderer must support configurable formatting without altering the underlying order totals.

---

# 14. Testing Strategy

## 14.1 Unit tests

Required tests include:

- ESC/POS byte generation.
- Paper-width formatting.
- Receipt and kitchen ticket rendering.
- Bridge message validation.
- Request ID correlation.
- Printer configuration validation.
- Job state transitions.
- Duplicate request detection.
- Retry decision logic.
- SQLite persistence.
- Sync outbox processing.
- Conflict handling.
- Offline queue restoration.

## 14.2 Integration tests

Test:

- WebView to native bridge.
- Native bridge to Print Manager.
- Print Manager to LAN driver.
- LAN driver against a compatible ESC/POS printer.
- Multiple print destinations.
- Application restart with pending jobs.
- Backend synchronization after offline operation.
- Authentication expiration.
- Printer configuration persistence.
- Network interruption and recovery.

## 14.3 Physical hardware tests

At minimum, validate:

1. Printer reachable and correctly configured.
2. Printer powered off.
3. Incorrect IP address.
4. Incorrect TCP port.
5. Tablet and printer on different VLANs or isolated networks.
6. Wi-Fi disconnected during connection establishment.
7. Network loss during transmission.
8. Printer powered off during transmission.
9. Empty paper roll.
10. Unsupported ESC/POS command.
11. Repeated print button clicks.
12. Multiple printers with different destinations.
13. Application terminated with queued jobs.
14. App restarted while offline.
15. Internet unavailable but LAN printer reachable.
16. Internet restored and pending operations synchronized.
17. Duplicate sync requests.
18. iOS local-network permission denied, where applicable.

Hardware tests must be recorded in the compatibility matrix.

## 14.4 Performance tests

Set initial acceptance targets:

- Native settings screen opens within 2 seconds on the supported test device.
- A local print request is persisted within 500 ms under normal device load.
- Network connection attempts have configurable bounded timeouts.
- Printer operations do not block the UI thread.
- The application can restore pending queues after a process restart.
- Multiple independent printers can be dispatched without serializing unrelated network connection setup.

These are engineering targets and must be measured on actual supported hardware. They are not guarantees about the time needed for paper to emerge.

## 14.5 Automated testing expectations

The agent must run:

- TypeScript checks.
- Linting.
- Unit tests.
- Relevant integration tests.
- Android build validation.
- iOS compilation or build validation where the environment supports it.

Report any test that could not run because hardware, platform tooling, or credentials were unavailable.

---

# 15. Acceptance Criteria

## 15.1 Application

- [ ] The application launches successfully on a supported Android device.
- [ ] The existing Spazio Next.js UI loads in WebView.
- [ ] Native printer settings are accessible.
- [ ] The app works without internet for explicitly supported offline workflows.
- [ ] Unsupported offline operations are clearly blocked or explained.

## 15.2 LAN printing

- [ ] A printer can be configured with a manual IP address and port.
- [ ] The configuration persists after app restart.
- [ ] A compatible ESC/POS printer can receive a test job.
- [ ] The application distinguishes connection success from confirmed physical output.
- [ ] A failed connection does not freeze the UI.
- [ ] Receipt and kitchen ticket destinations can be configured independently.
- [ ] A single action can dispatch jobs to multiple printers.
- [ ] A failed job remains visible for manual recovery.
- [ ] Ambiguous jobs are not silently reprinted.

## 15.3 Offline

- [ ] Supported local order data is saved transactionally.
- [ ] Pending print jobs survive app restart.
- [ ] LAN printing continues when internet access is unavailable.
- [ ] Pending backend operations survive process termination.
- [ ] Synchronization resumes when connectivity returns.
- [ ] Duplicate synchronization requests are safely handled where supported by the backend.
- [ ] Unsynchronized orders are not silently deleted.

## 15.4 Security

- [ ] Only approved WebView origins can access the privileged bridge.
- [ ] Bridge messages are validated.
- [ ] Arbitrary printer IPs cannot be injected through untrusted messages.
- [ ] Credentials and sensitive order data are not written to ordinary diagnostic logs.
- [ ] Printer configuration and offline data are scoped to the correct outlet/user.

## 15.5 Cross-platform

- [ ] Android LAN printing is verified on actual hardware.
- [ ] iOS builds compile in a supported environment.
- [ ] iOS LAN permissions are implemented and tested.
- [ ] Unsupported iOS transport features are documented and disabled gracefully.
- [ ] The documentation identifies which exact printer models and transport types have been validated.

---

# 16. Proposed Project Structure

The agent may adjust this structure to the chosen React Native framework, but it must maintain equivalent separation of concerns.

```text
spazio-native-pos/
├── src/
│   ├── app/
│   │   ├── navigation/
│   │   └── screens/
│   │       ├── DeviceStatusScreen.tsx
│   │       ├── PrinterListScreen.tsx
│   │       ├── PrinterFormScreen.tsx
│   │       ├── PrinterDiagnosticsScreen.tsx
│   │       ├── PrintJobsScreen.tsx
│   │       └── OfflineStatusScreen.tsx
│   │
│   ├── webview/
│   │   ├── SpazioWebView.tsx
│   │   ├── bridge/
│   │   │   ├── BridgeProtocol.ts
│   │   │   ├── BridgeValidator.ts
│   │   │   └── BridgeHandler.ts
│   │   └── navigationPolicy.ts
│   │
│   ├── printing/
│   │   ├── PrinterManager.ts
│   │   ├── PrinterConfig.ts
│   │   ├── PrintDispatcher.ts
│   │   ├── PrintQueue.ts
│   │   ├── PrintJobRepository.ts
│   │   ├── EscPosRenderer.ts
│   │   ├── ReceiptTemplate.ts
│   │   ├── KitchenTicketTemplate.ts
│   │   └── drivers/
│   │       ├── LanPrinterDriver.ts
│   │       ├── BluetoothPrinterDriver.ts
│   │       └── UsbPrinterDriver.ts
│   │
│   ├── offline/
│   │   ├── LocalDatabase.ts
│   │   ├── DatabaseMigrations.ts
│   │   ├── LocalOrderRepository.ts
│   │   ├── SyncOutbox.ts
│   │   ├── SyncEngine.ts
│   │   └── ConflictResolver.ts
│   │
│   ├── networking/
│   │   ├── ConnectivityMonitor.ts
│   │   └── ApiClient.ts
│   │
│   ├── security/
│   │   ├── SecureStorage.ts
│   │   ├── TrustedOriginPolicy.ts
│   │   └── PayloadValidation.ts
│   │
│   ├── types/
│   └── utils/
│
├── android/
├── ios/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── hardware/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PRINTER_COMPATIBILITY.md
│   ├── BRIDGE_PROTOCOL.md
│   ├── OFFLINE_SYNC.md
│   ├── SECURITY.md
│   ├── TESTING.md
│   └── BUILD_RELEASE.md
│
├── package.json
├── tsconfig.json
└── README.md
```

The listed structure is a target, not a requirement to create empty files. Every implemented module must have a clear responsibility and meaningful tests.

---

# 17. Implementation Phases

## Phase 0 — Discovery and technical validation

Deliverables:

- Existing Next.js architecture and API inventory.
- React Native framework decision.
- Printer library evaluation.
- LAN socket feasibility validation on Android.
- Offline capability gap analysis.
- Authentication and bridge security design.
- Platform capability matrix.
- List of unresolved requirements.

Do not begin a full rewrite before this assessment is complete.

## Phase 1 — Native shell and bridge

Implement:

- React Native project.
- WebView loading the existing Spazio application.
- Trusted-origin validation.
- Native settings navigation.
- Versioned bridge protocol.
- Logging and diagnostics.

Acceptance: the existing POS UI works in the new application and the bridge can safely exchange test messages.

## Phase 2 — LAN printing MVP

Implement:

- Printer settings.
- Manual IP/port configuration.
- TCP transport.
- ESC/POS renderer.
- Test printing.
- Receipt and kitchen destinations.
- Persistent print-job queue.
- Manual recovery and error states.

Acceptance: actual supported Ethernet printers can print test receipts and kitchen tickets.

## Phase 3 — Offline persistence and synchronization

Implement:

- Local database.
- Offline order support based on existing business rules.
- Persistent outbox.
- Sync engine.
- Conflict handling.
- Offline status and recovery UI.

Acceptance: supported offline operations survive app restart and reconcile safely with the backend.

## Phase 4 — Bluetooth and USB

Implement and validate each supported transport independently.

Acceptance: every declared supported printer/connection combination passes the documented hardware tests.

## Phase 5 — iOS compatibility

Implement and validate iOS-specific networking, permissions, and supported printing transports.

Acceptance: iOS builds successfully, LAN printing works with verified hardware, and unsupported transport combinations fail gracefully with documentation.

## Phase 6 — Production readiness

Complete:

- Security review.
- Crash and recovery testing.
- Performance tests.
- Release configuration.
- APK/AAB generation.
- iOS archive configuration.
- Deployment and maintenance documentation.

---

# 18. Build and Release Instructions

The agent must document exact commands that work with the selected framework and package versions.

## 18.1 Android development

For a React Native project using the bare Android workflow:

```bash
npm install
npx react-native doctor
npx react-native run-android
```

These commands assume Android Studio, the Android SDK, a supported JDK, and a connected emulator or device are configured.

If Expo with a custom development build is selected, document the equivalent commands and ensure the required native modules are included.

## 18.2 Android release APK

On Windows:

```powershell
cd android
.\gradlew.bat assembleRelease
```

On Linux/macOS:

```bash
cd android
./gradlew assembleRelease
```

The agent must configure release signing using environment variables or an appropriate secret-management mechanism. Never commit signing keys or passwords to the repository.

The expected APK location for a standard Gradle project is commonly:

```text
android/app/build/outputs/apk/release/app-release.apk
```

The agent must verify the actual output path.

## 18.3 Android App Bundle

For Google Play distribution:

```bash
cd android
./gradlew bundleRelease
```

Use the Windows Gradle wrapper variant when building on Windows.

## 18.4 iOS build

On macOS with Xcode:

```bash
cd ios
pod install
```

Then open the generated `.xcworkspace` in Xcode, configure signing and provisioning, and build/archive the app.

The agent must document the required Apple Developer configuration and validate the actual release process.

## 18.5 Release requirements

Every release must include:

- Version number.
- Build number.
- Build instructions.
- Environment configuration.
- Required permissions.
- Supported printer matrix.
- Known limitations.
- Installation and rollback instructions.
- Test results.
- Release notes.

Do not claim that an APK or iOS archive has been generated unless the build has actually succeeded.

---

# 19. Documentation Requirements

The agent must deliver:

1. `README.md` — installation and development.
2. `ARCHITECTURE.md` — system boundaries and data flow.
3. `PRINTER_COMPATIBILITY.md` — verified hardware and supported transports.
4. `BRIDGE_PROTOCOL.md` — request/response schemas and security.
5. `OFFLINE_SYNC.md` — local persistence, synchronization, and conflict handling.
6. `SECURITY.md` — trust boundaries, permissions, and data protection.
7. `TESTING.md` — automated and physical hardware tests.
8. `BUILD_RELEASE.md` — Android and iOS build procedures.
9. `KNOWN_LIMITATIONS.md` — unsupported scenarios and unresolved dependencies.

---

# 20. Instructions to the Coding Agent

You are implementing Spazio Native POS. Follow these instructions in order.

1. Inspect the existing Spazio Next.js application, API contracts, authentication, order lifecycle, receipt templates, and PWA functionality before modifying anything.
2. Produce a short architecture and integration report.
3. Identify unknown business rules and backend requirements. Do not invent them.
4. Evaluate the chosen React Native workflow and printer libraries against actual platform capabilities.
5. Implement Android LAN ESC/POS printing as the first end-to-end hardware milestone.
6. Keep native settings, printer drivers, ESC/POS formatting, bridge handling, and offline synchronization as separate modules.
7. Preserve the existing Next.js UI and business logic wherever practical.
8. Build the bridge using a versioned, validated message protocol.
9. Persist print jobs before reporting that they have been queued.
10. Do not automatically repeat ambiguous print jobs.
11. Implement offline behavior only for operations whose business rules can be safely supported locally.
12. Require idempotent synchronization contracts or explicitly document backend gaps.
13. Add tests alongside each feature.
14. Validate the implementation on physical printer hardware.
15. Build and test Android before expanding transport support.
16. Implement iOS capabilities according to verified platform constraints.
17. Update documentation as features are completed.
18. Do not leave mock implementations, empty handlers, or fake success responses in production code.
19. Do not claim a printer, transport, offline workflow, or release build is supported until it has been validated.
20. At the end, report completed features, test results, hardware tested, limitations, required backend changes, and exact build commands.

## Definition of done

The initial release is complete when an Android tablet can run the existing Spazio UI inside the native application, configure a compatible Ethernet printer manually, print customer receipts and kitchen tickets through native ESC/POS networking, persist print jobs across app restarts, recover from printer errors manually, and execute the explicitly supported offline workflows without silently losing orders or duplicating print jobs.

iOS, Bluetooth, and USB support must be separately verified and documented before they are advertised as production-ready.

---

**End of PRD**