# Privacy

MenüQR Bridge connects a restaurant-controlled Windows computer to the MenüQR
service and to devices on that restaurant's private network.

## Network communication

Bridge makes outbound connections to:

- the configured MenüQR HTTPS API for pairing, device status, job delivery,
  acknowledgement, support requests, and revocation;
- the public MenüQR update CDN when automatic update checks are enabled;
- a user-configured printer on the private local network.

The application does not expose an inbound web server or a public printer
endpoint.

## Local data

Bridge stores the encrypted device credential, a random device fingerprint,
printer configuration, last-known printer health, a bounded job-deduplication
ledger, and bounded diagnostic logs in the current user's application-data
directory. Printer host addresses remain local and are not sent to analytics.

Diagnostics are exported only after an explicit user action. They are redacted
and must not contain credentials, raw order payloads, or local network topology.
Uninstalling the application asks whether this local data should also be
removed.

## Order processing

Kitchen order data is received only to render and deliver the requested local
print job. The local deduplication ledger stores bounded job identifiers and
execution state, not a historical copy of printed kitchen-bon content.

## Telemetry

Bridge contains no advertising SDK and no third-party behavioural analytics.
Operational device state and redacted adapter health are sent to MenüQR so the
restaurant can see whether its own integration is available.
