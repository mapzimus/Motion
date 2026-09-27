# Ferry water audit report

Generated 2026-09-27 by `scripts/audit-ferry-water.py --report`.
Audit version `osm-land-v3`: OpenStreetMap coastline land polygons minus OSM inland water.
Rules: interior dry run <= 25 m; dry run within 300 m of an endpoint <= 150 m; no self-intersection; each path > 0.15 km and >= 0.95 x terminal distance.

BEFORE = the previously committed `data/regional-routes.geojson` geometry measured with the new model (`-` = route not in that snapshot, e.g. a newly adopted GTFS feed id). AFTER = `scripts/ferry-water-cache.json`.
Dry metres are the longest single dry run of each kind.

Routes: 93 · failing BEFORE: 69 · failing AFTER: 0

Geometry sources: gtfs-shape 25, gtfs-shape (repaired) 4, gtfs-shape+osm-way 1, hand 13, hand (repaired) 4, osm-way 31, osm-way (repaired) 15

| Route | Source | Length km | Length / direct | Interior dry m (before → after) | Endpoint dry m (before → after) | Self-int. before | Result |
|---|---|---:|---:|---:|---:|:---:|:---:|
| `balmy-days:boothbay-monhegan` | osm-way:695680821 | 29.61 | 1.12 | 0 → 0 | 155 → 140 | yes | pass |
| `bay-state-cruise:2057` | gtfs-shape | 172.76 | 1.10 | 0 → 0 | 6 → 6 | no | pass |
| `beal-bunker:northeast-harbor-cranberry-isles` | hand | 7.98 | 1.90 | 428 → 0 | 98 → 0 | yes | pass |
| `block-island-express:block-island-orient-point` | hand | 61.17 | 1.07 | 0 → 0 | 23 → 23 | yes | pass |
| `block-island-express:new-london-block-island` | osm-way:609350617 | 58.04 | 1.17 | 0 → 0 | 302 → 126 | no | pass |
| `block-island-ferry:2059` | gtfs-shape | 47.28 | 1.02 | 0 → 0 | 7 → 7 | no | pass |
| `block-island-ferry:newport-block-island` | osm-way:609828137 | 41.79 | 1.04 | 72 → 0 | 12 → 12 | yes | pass |
| `boston-harbor-islands:GI` | gtfs-shape | 23.69 | 1.09 | 0 → 0 | 0 → 0 | no | pass |
| `boston-harbor-islands:HIGI` | gtfs-shape (repaired) | 15.03 | 1.01 | 184 → 0 | 5 → 6 | yes | pass |
| `boston-harbor-islands:PI` | gtfs-shape | 11.05 | 1.10 | 0 → 0 | 13 → 13 | no | pass |
| `boston-harbor-islands:SI` | gtfs-shape | 14.63 | 1.09 | 0 → 0 | 0 → 0 | no | pass |
| `boston-launch:harbor-shuttle` | osm-way:1190882265 | 2.62 | 1.14 | 0 → 0 | 0 → 0 | no | pass |
| `boston-seaport-ferry:east-boston-fan-pier` | osm-way:987468552 (repaired) | 1.46 | 1.01 | 0 → 0 | 34 → 20 | yes | pass |
| `boston-seaport-ferry:lovejoy-fan-pier-10` | hand (repaired) | 6.54 | 2.01 | 472 → 0 | 153 → 76 | yes | pass |
| `bridgeport-port-jefferson:main` | osm-way:54689694 | 28.05 | 1.04 | 344 → 0 | 45 → 83 | no | pass |
| `bridgeport-water-taxi:pleasure-beach` | hand | 3.16 | 1.50 | 73 → 0 | 81 → 74 | no | pass |
| `captain-john:plymouth-provincetown` | hand | 46.34 | 1.17 | 218 → 0 | 0 → 0 | yes | pass |
| `casco-bay:DB` | gtfs-shape (repaired) | 204.31 | 1.26 | 27 → 4 | 0 → 0 | yes | pass |
| `casco-bay:IB` | gtfs-shape (repaired) | 79.26 | 1.17 | 0 → 0 | 0 → 0 | yes | pass |
| `casco-bay:PK` | gtfs-shape | 16.26 | 1.06 | 0 → 0 | 0 → 0 | no | pass |
| `chappy-ferry:edgartown-chappaquiddick` | osm-way:61756495 | 0.36 | 1.15 | 0 → 0 | 0 → 34 | no | pass |
| `chebeague-transportation:cousins-chebeague` | osm-way:1547409708 | 2.51 | 1.00 | 548 → 0 | 399 → 0 | yes | pass |
| `city-cruises:boston-provincetown` | osm-way:1112445421 | 87.26 | 1.10 | 633 → 0 | 119 → 0 | yes | pass |
| `cranberry-cove:southwest-harbor-cranberry-isles` | osm-way:11428675+731120557+11432849 | 7.59 | 1.19 | 217 → 0 | 166 → 14 | yes | pass |
| `cranberry-isles:commuter` | osm-way:11426785+11432849 | 7.17 | 1.36 | 428 → 0 | 98 → 0 | yes | pass |
| `cross-sound-ferry:new-london-orient-point` | osm-way:45127361 (repaired) | 27.82 | 1.09 | 70 → 0 | 437 → 70 | yes | pass |
| `ctdot-ferry:chester-hadlyme` | osm-way:93661090 | 0.33 | 1.00 | 0 → 0 | 12 → 12 | no | pass |
| `ctdot-ferry:rocky-hill-glastonbury` | osm-way:17192965 | 0.41 | 1.40 | 0 → 0 | 22 → 0 | no | pass |
| `cuttyhunk-ferry:2098` | gtfs-shape | 50.90 | 1.09 | 0 → 0 | 0 → 0 | no | pass |
| `downeast-windjammer:bar-harbor-winter-harbor` | osm-way:692922750 | 13.24 | 1.39 | 1,009 → 0 | 67 → 24 | yes | pass |
| `downeast-windjammer:eastport-lubec` | osm-way:692925635 (repaired) | 6.64 | 1.32 | 0 → 0 | 39 → 75 | yes | pass |
| `encore-harbor-shuttle:long-wharf-everett` | osm-way:816330918 (repaired) | 5.50 | 1.30 | 112 → 0 | 298 → 109 | yes | pass |
| `fishers-island-ferry:new-london-fishers-island` | osm-way:609332006 (repaired) | 12.50 | 1.03 | 24 → 0 | 464 → 61 | yes | pass |
| `flyers-long-point:provincetown-long-point` | osm-way:1540046597 | 2.73 | 1.09 | 0 → 0 | 0 → 84 | yes | pass |
| `fort-ti-ferry:shoreham-ticonderoga` | osm-way:34108380 | 0.72 | 1.00 | 0 → 0 | 18 → 18 | no | pass |
| `freedom-cruise:harwich-port-nantucket` | gtfs-shape | 86.36 | 1.01 | 191 → 0 | 173 → 0 | no | pass |
| `frye-island-ferry:raymond-cape-frye` | hand | 1.70 | 1.00 | 0 → 0 | 0 → 0 | no | pass |
| `gloucester-water-shuttle:harbor-loop` | hand (repaired) | 3.43 | 1.28 | 112 → 0 | 215 → 0 | yes | pass |
| `greenwich-ferry:great-captain-island` | osm-way:716797073 (repaired) | 4.36 | 1.19 | 215 → 0 | 100 → 96 | yes | pass |
| `greenwich-ferry:island-beach` | osm-way:716797072 | 3.40 | 1.10 | 42 → 0 | 0 → 0 | yes | pass |
| `hardy-boat:new-harbor-monhegan` | osm-way:695680823 | 18.41 | 1.02 | 0 → 0 | 252 → 38 | no | pass |
| `hy-line:2112` | gtfs-shape | 92.52 | 1.07 | 0 → 0 | 6 → 6 | no | pass |
| `hy-line:2113` | gtfs-shape | 67.15 | 1.07 | 0 → 0 | 0 → 0 | no | pass |
| `hy-line:2115` | gtfs-shape+osm-way:42759945 | 90.98 | 1.05 | 231 → 0 | 40 → 9 | no | pass |
| `ica-water-shuttle:seaport-watershed` | osm-way:987468552 (repaired) | 1.35 | 1.00 | 0 → 0 | 54 → 53 | yes | pass |
| `island-queen:falmouth-oak-bluffs` | osm-way:518549076 (repaired) | 11.66 | 1.06 | 715 → 0 | 378 → 45 | no | pass |
| `isle-au-haut-boat:stonington-town-landing` | gtfs-shape (repaired) | 53.54 | 1.15 | 190 → 0 | 310 → 92 | yes | pass |
| `isles-of-shoals:portsmouth-star-island` | osm-way:435474719 (repaired) | 18.05 | 1.12 | 282 → 0 | 67 → 109 | no | pass |
| `jamestown-newport-ferry:hop-on-loop` | osm-way:716707470+716707466+716707469+716707474 | 6.76 | 1.62 | 200 → 0 | 49 → 81 | yes | pass |
| `lake-champlain-ferries:charlotte-essex` | gtfs-shape | 9.17 | 1.04 | 49 → 0 | 35 → 14 | no | pass |
| `lake-champlain-ferries:grand-isle-plattsburgh` | gtfs-shape | 5.76 | 1.07 | 0 → 0 | 111 → 18 | no | pass |
| `maine-state-ferry:bass-harbor-frenchboro` | gtfs-shape | 28.46 | 1.12 | 248 → 0 | 35 → 0 | yes | pass |
| `maine-state-ferry:bass-harbor-swans-island` | gtfs-shape | 20.20 | 1.20 | 471 → 0 | 60 → 81 | no | pass |
| `maine-state-ferry:lincolnville-islesboro` | gtfs-shape | 10.60 | 1.03 | 0 → 0 | 12 → 137 | no | pass |
| `maine-state-ferry:rockland-matinicus` | gtfs-shape | 79.27 | 1.23 | 694 → 0 | 520 → 148 | yes | pass |
| `maine-state-ferry:rockland-north-haven` | gtfs-shape | 40.62 | 1.08 | 880 → 0 | 26 → 0 | yes | pass |
| `maine-state-ferry:rockland-vinalhaven` | gtfs-shape | 48.24 | 1.07 | 292 → 0 | 26 → 0 | yes | pass |
| `monhegan-boat-line:port-clyde-monhegan` | osm-way:695680820 | 18.86 | 1.01 | 569 → 0 | 64 → 70 | no | pass |
| `mount-kineo-shuttle:rockwood-kineo` | osm-way:1270895553 | 1.52 | 1.00 | 0 → 0 | 0 → 0 | no | pass |
| `mount-washington:weirs-alton-bay` | hand | 26.49 | 1.13 | 136 → 0 | 76 → 76 | no | pass |
| `mount-washington:weirs-wolfeboro` | hand | 22.11 | 1.09 | 66 → 0 | 114 → 114 | no | pass |
| `newport-harbor-shuttle:loop` | hand (repaired) | 4.91 | 1.21 | 190 → 0 | 0 → 0 | yes | pass |
| `norwalk-seaport:sheffield-island` | osm-way:716771600 | 6.33 | 1.12 | 457 → 0 | 30 → 62 | yes | pass |
| `patriot-water-shuttle:falmouth-oak-bluffs` | gtfs-shape | 21.29 | 1.02 | 56 → 0 | 391 → 0 | yes | pass |
| `pied-piper:falmouth-edgartown` | osm-way:518550902 (repaired) | 20.94 | 1.10 | 96 → 0 | 203 → 59 | yes | pass |
| `prudence-island-ferry:bristol-prudence` | osm-way:621734436 | 6.01 | 1.02 | 0 → 0 | 8 → 0 | no | pass |
| `robin-r:rockland-matinicus` | hand | 35.30 | 1.09 | 760 → 0 | 469 → 22 | yes | pass |
| `salem-ferry:salem-boston` | osm-way:99270540 | 37.22 | 1.63 | 336 → 0 | 91 → 112 | yes | pass |
| `seastreak:marthas-vineyard-nantucket` | osm-way:1085662852 (repaired) | 44.39 | 1.04 | 236 → 0 | 162 → 63 | yes | pass |
| `seastreak:new-bedford-marthas-vineyard` | gtfs-shape | 76.25 | 1.05 | 1,152 → 0 | 306 → 0 | yes | pass |
| `seastreak:new-bedford-nantucket` | gtfs-shape | 165.41 | 1.05 | 193 → 0 | 166 → 4 | yes | pass |
| `seastreak:providence-bristol-newport` | gtfs-shape | 82.95 | 1.12 | 55 → 0 | 9 → 1 | yes | pass |
| `sophie-c:mailboat` | hand (repaired) | 51.45 | 1.79 | 269 → 6 | 14 → 14 | yes | pass |
| `squirrel-island-mailboat:boothbay-squirrel` | osm-way:695675250 (repaired) | 5.81 | 1.09 | 54 → 0 | 117 → 102 | yes | pass |
| `steamship-authority:HY-NT` | osm-way:42759945 (repaired) | 46.39 | 1.07 | 0 → 0 | 0 → 111 | no (zero-length) | pass |
| `steamship-authority:NT-HY` | osm-way:42759945 (repaired) | 46.39 | 1.07 | 0 → 0 | 0 → 111 | no (zero-length) | pass |
| `steamship-authority:OB-WH` | osm-way:717299243 | 13.66 | 1.14 | 0 → 0 | 0 → 15 | no (zero-length) | pass |
| `steamship-authority:VH-WH` | osm-way:71493738 | 12.71 | 1.34 | 0 → 0 | 0 → 15 | no (zero-length) | pass |
| `steamship-authority:WH-OB` | osm-way:717299243 | 13.66 | 1.14 | 0 → 0 | 0 → 15 | no (zero-length) | pass |
| `steamship-authority:WH-VH` | osm-way:71493738 | 12.71 | 1.34 | 0 → 0 | 0 → 15 | no (zero-length) | pass |
| `swan-island-wma:richmond-swan-island` | hand | 0.22 | 1.00 | 0 → 0 | 1,620 → 0 | no | pass |
| `thames-river-water-taxi:loop` | hand | 4.69 | 1.01 | 0 → 0 | 36 → 35 | yes | pass |
| `the-cat:bar-harbor-yarmouth` | osm-way:660595647 | 188.04 | 1.05 | 146 → 0 | 86 → 78 | yes | pass |
| `thimble-islands-ferry:stony-creek-outer-island` | osm-way:716911033 | 2.74 | 1.12 | - → 0 | - → 0 | - | pass |
| `thompson-island-ferry:south-boston-thompson` | gtfs-shape | 9.95 | 1.44 | 0 → 0 | 0 → 0 | no | pass |
| `uncle-oscar:rye-star-island` | osm-way:435479811 | 11.66 | 1.03 | 0 → 0 | 16 → 93 | yes | pass |
| `vermont-state-parks:kill-kare-burton-island` | osm-way:941987962 | 1.40 | 1.12 | 70 → 0 | 127 → 12 | no | pass |
| `viking-fleet:block-island-montauk` | hand | 37.79 | 1.11 | 87 → 0 | 343 → 65 | yes | pass |
| `viking-fleet:new-london-montauk` | osm-way:609350620 (repaired) | 34.02 | 1.01 | 0 → 0 | 431 → 64 | no | pass |
| `vineyard-fast-ferry:2099` | gtfs-shape | 91.50 | 1.26 | 0 → 0 | 0 → 0 | no | pass |
| `vineyard-fast-ferry:2100` | gtfs-shape | 90.79 | 1.25 | 0 → 0 | 13 → 13 | no | pass |
| `winnipesaukee-belle:meredith-weirs` | hand | 6.42 | 1.05 | 0 → 0 | 14 → 13 | no | pass |
| `winnipesaukee-spirit:center-harbor-wolfeboro` | hand | 26.80 | 1.09 | 69 → 0 | 114 → 114 | no | pass |

Routes in the BEFORE snapshot that no longer exist under the same id:

- `isle-au-haut-boat:stonington-duck-harbor`: interior 536 m, endpoint 19 m, self-intersecting
