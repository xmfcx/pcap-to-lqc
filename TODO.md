# TODO

The browser converter is deployed and processes files locally, including the full supplied capture. The next milestone is independent validation of its output and acceptance in Applanix POSPac.

## Priority 1: Validate conversion accuracy and POSPac compatibility

- [ ] Compare a short real capture against the official Hesai SDK using identical calibration. Check XYZ, per-point firing timestamps, and all supported return modes; establish whether optical-center corrections are needed.
- [ ] Import generated LQC into POSPac. Confirm byte order, LQC 1.0/1.1 layouts, laser IDs, return numbering, intensity, and GPS seconds of week. Record the POSPac version, settings, and results; little-endian is currently an assumption.
- [ ] Validate timing and spatial alignment with a matching navigation trajectory, known sensor time scale, and mounting configuration. No matching trajectory is included with the supplied sample.
- [ ] Add a small redistributable real capture fixture and independently verified expected output to automated tests. Cover return modes and timing boundaries so future changes can be checked against known results.

## Priority 2: Improve reliability and large-file handling

- [ ] Add configurable output splitting with a conversion report identifying each part. The supplied 3.15 GiB capture produces about 5.87 GiB of LQC.
- [ ] Split output at GPS week boundaries and record each part's GPS week, allowing captures that currently fail because they cross a week boundary.
- [ ] Include the application build or commit identifier in conversion reports so results can be traced to the exact converter version.
- [ ] Maintain the UTC leap-second table and its verified date range beyond 2026. Preserve explicit errors for dates outside that range unless the user supplies a verified custom offset.
- [ ] Improve offline application updates: remove obsolete caches and ensure an open session uses a consistent set of application assets during an update.
- [ ] Manually test native Save As and large-file conversion on Windows Chrome and Edge, including cancellation and insufficient disk space. Browser automation currently substitutes the picker and writes to browser-private storage.
- [ ] Update release documentation with the live site and validated compatibility results, and choose a repository license.

## Optional: Expand supported workflows

- [ ] Support PCAPNG input.
- [ ] Support streaming ZIP input without loading the complete archive into memory.
- [ ] Add batch conversion with separate outputs and reports for each capture.
- [ ] Add other sensor models only with matching protocol documentation, calibration support, and independent validation fixtures.
