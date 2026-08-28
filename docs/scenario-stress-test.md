# MenüQR Bridge Functional Stress Test

This is a functional and reliability stress test, not a throughput benchmark.
It verifies that real table orders remain readable, deterministic, correctly
priced, and protected from accidental duplicate printing across failures.

## Automated order matrix

The automated matrix covers all supported combinations of:

- Star Line and ESC/POS command modes;
- 80 mm and 82 mm paper widths;
- CP437, CP850, and Windows-1252 encodings;
- compact, kitchen-plus, and detailed bon layouts;
- one through 50 order lines and quantities from one through 50;
- zero, one-decimal, large grouped, EUR, and non-EUR prices;
- item variations, item notes, order notes, and empty optional text;
- German characters, unsupported Unicode, emoji, Cyrillic, control bytes, and
  long unbroken text;
- normal orders and explicit reprints;
- linked follow-up orders with a prominent `NACHBESTELLUNG` marker, sequence,
  previous order reference, and only newly submitted positions;
- staff additions, changes, and removals as separate `NACHBESTELLUNG`,
  `ÄNDERUNG`, and `STORNIERUNG` tickets containing only the affected position;
- quantity changes with explicit `ALT`, `NEU`, `ZUSÄTZLICH`, and `STORNIEREN`
  values, note changes with old/new labels, and full-bill cancellation listing
  every affected position;
- tables one through 500, long restaurant names, order references, dates,
  times, and the Vienna daylight-saving fallback;
- the largest public order shape accepted by the backend;
- corrupt payloads: empty items, invalid quantities/timestamps/decimals,
  negative totals, inconsistent line/order totals, and duplicate item IDs.

`kitchen-bon-scenario-matrix.spec.ts` renders 120 deterministic real-world
orders in four printer configurations and three layouts (1,440 full renderer
combinations) and asserts byte determinism, width, content hierarchy, size, and
final cut command.

## Automated delivery matrix

`order-delivery-scenario-matrix.integration.spec.ts` verifies:

- 40 different queued orders print exactly once;
- replaying all 40 jobs does not write a second bon;
- deduplication survives an application restart;
- an acknowledgement lost after printing is retried after restart without a
  second printer write;
- a confirmed pre-write printer failure is retried and later acknowledged;
- a changed payload under an existing job ID is rejected without printing.
- an initial order and its follow-up produce two linked writes without repeating
  the initial positions on the follow-up bon.

The existing integration suites additionally cover pairing, heartbeat, long
polling, fake TCP printer transport, lease acknowledgement loss, cancellation,
and the complete simulated order-to-printer path.

## Defects found by this matrix

1. A valid 50-line public order could exceed the Bridge's old 120-line render
   guard and fail before reaching the printer. The guard now covers the full
   backend input contract while retaining the 64 KiB byte safety bound.
2. Negative prices, mathematically inconsistent line totals, inconsistent order
   totals, and duplicate item IDs could reach rendering. The Bridge now rejects
   them as terminally corrupt payloads before any printer write.

## Physical pilot matrix

The following scenarios cannot be truthfully certified without Windows and a
real Star TSP1000. Run them before general production rollout:

1. One-item order, normal cut, readable German characters.
2. Fifty-item order with the maximum supported notes and continuous paper feed.
3. Cover open before the job arrives, then close and recover.
4. Paper empty before the job arrives, refill, then recover.
5. Printer powered off before connect, power on, then recover.
6. Ethernet removed before connect, reconnect, then recover.
7. Ethernet removed while bytes are being written; inspect whether a partial or
   duplicate bon is physically produced.
8. Backend connection lost after the physical bon but before acknowledgement;
   verify no duplicate after reconnect and Bridge restart.
9. Windows restart with a queued order.
10. Bridge process crash before write, during write, and after write.
11. DHCP address change followed by discovery and explicit re-selection.
12. Two compatible Bridge devices polling the same restaurant; only one may
    receive a lease and print.
13. Manual reprint visibly starts with `NACHDRUCK`; a normal order never does.
14. Star Line mode on the physical printer.
15. ESC/POS mode only when the physical printer is configured for it.
16. 80 mm and 82 mm configurations with right-aligned time, date, and prices.
17. Windows tray offline notification and recovery state.
18. Device revocation while polling; no later order may print.
19. Pro downgrade with queued history preserved but no new lease.
20. Upgrade from the previous installer with pairing, printer configuration,
    and the local deduplication ledger preserved.

## Acceptance rule

Automated success proves renderer and simulated delivery behavior only. It is
not evidence of the printer firmware, cutter, Windows tray, DPAPI, installer,
LAN, or physical partial-write behavior. Those remain blocked until the pilot
matrix is executed on the target Windows computer and Star TSP1000.
