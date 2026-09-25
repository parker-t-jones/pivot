# Carriage confirm (B1.1)

Desk check of MVPD live-NFL carriage for carriage map `2026.1`.
Mark `confirmed: true` in code only where a provider page (or Ticket /
standalone product rule) lists the network. Checked **2026-09-25**.

Sling stays empty (`confirmed: false`, `networks: []`).

## Summary

| Service | CBS | FOX | NBC | ABC | ESPN | NFL Network | Source |
|---|---|---|---|---|---|---|---|
| `youtube_tv` | yes | yes | yes | yes | yes | yes | YouTube TV + CableTV channel list |
| `hulu_live` | yes | yes | yes | yes | yes | yes | Hulu official channel guide |
| `fubo` | yes* | yes* | yes* | yes* | yes | yes | Fubo NFL page + Help Center |
| `directv` | yes* | yes* | yes* | yes* | yes | yes | DIRECTV packages FAQ + Stream lineup PDF |
| `sunday_ticket` | yes† | yes† | — | — | — | — | Product rule (out-of-market Sunday early/late only) |
| Standalone apps | own network only | | | | | | High-confidence product rule |
| `sling` | — | — | — | — | — | — | Empty until package probe |

\* Local affiliates vary by ZIP.  
† Ticket does not carry TNF / SNF / MNF / NFLN exclusives.

## YouTube TV

| Network | Listed? |
|---|---|
| CBS | yes |
| FOX | yes |
| NBC | yes |
| ABC | yes |
| ESPN | yes |
| NFL Network | yes |

- https://tv.youtube.com/learn/explore-plans/ — “CBS, FOX, NBC… complete local network coverage in over 98% of US TV households”
- https://support.google.com/youtubetv/answer/7370552 — local sports/news on CBS, FOX, NBC, and more
- Cross-check channel matrix: https://www.cabletv.com/youtube-tv/channels (lists ABC, CBS, FOX, NBC, ESPN, NFL Network on the base plan)

**Decision:** `confirmed: true` for all six.

## Hulu + Live TV

| Network | Listed? |
|---|---|
| CBS | yes |
| FOX | yes |
| NBC | yes |
| ABC | yes |
| ESPN | yes |
| NFL Network | yes |

- https://www.hulu.com/live-tv — “NFL teams on ABC, CBS, ESPN, FOX, NBC, and NFL Network”
- https://www.hulu.com/guides/hulu-live-tv-channels (dated March 18, 2026) — full list includes ABC, CBS, FOX, NBC, ESPN, NFL Network
- https://help.hulu.com/article/hulu-nfl-availability — NBC, CBS, FOX, ESPN, NFL Network

**Decision:** `confirmed: true` for all six.

## Fubo

| Network | Listed? |
|---|---|
| CBS | yes (local varies) |
| FOX | yes (local varies) |
| NBC | yes (local varies) |
| ABC | yes (local varies) |
| ESPN | yes |
| NFL Network | yes |

- https://www.fubo.tv/stream/nfl — table: CBS, FOX, NBC, ESPN, ABC, NFL Network all marked on Fubo
- https://support.fubo.tv/hc/en-us/articles/115003481307 — channel search lists CBS, FOX, NBC, ESPN, NFL Network on Essential+ plans; ABC via local check
- https://support.fubo.tv/hc/en-us/articles/4404852515341 — Sunday regional CBS/FOX; MNF on ESPN

**Decision:** `confirmed: true` for all six.

## DIRECTV

| Network | Listed? |
|---|---|
| CBS | yes (local, where available) |
| FOX | yes (local, where available) |
| NBC | yes (local, where available) |
| ABC | yes (local, where available) |
| ESPN | yes (ch. 206 on Stream lineup) |
| NFL Network | yes (ch. 212) |

- https://www.directv.com/packages/ — “local channels like ABC, CBS, FOX, NBC, PBS, and The CW… where available”
- https://streamtv.directv.com/dtvassets/sales/directv/upper_funnel/byod/channels/DIRECTV-STREAM-Channel-Lineup.pdf — ESPN 206, NFL Network 212
- https://www.directv.com/channel-lineup/ — ZIP-based lineup tool

**Decision:** `confirmed: true` for all six.

## High-confidence without lineup scrape

| Service | Networks | Why confirmed |
|---|---|---|
| `sunday_ticket` | `cbs`, `fox` (Sunday · Early / Late only) | Product definition; out-of-market Sunday afternoon |
| `amazon_prime` | `amazon_prime` | Exclusive TNF rights holder |
| `peacock` | `peacock` | Exclusive when ESPN lists Peacock |
| `paramount_plus` | `paramount_plus` | Exclusive when ESPN lists it |
| `espn_plus` | `espn_plus` | Exclusive when ESPN lists ESPN+ |
| `nfl_plus` | `nfl_plus`, `nfl_network` | Decided §9.9 — not local CBS/FOX |

## Sling

Left empty. Orange/Blue packages split FOX/NBC/ESPN and often omit CBS.
Do not guess. `confirmed: false`, `networks: []`.
