# PCAP to LQC

Convert **Hesai XT32M2X** PCAP captures to **Applanix LQC 1.0 or 1.1**, entirely on your computer. The browser reads the selected files, converts them in a worker, and saves the result locally. No upload service, account, or backend is required.

**Preview release:** decoding and serialization are tested, including the supplied real capture. POSPac import compatibility has not yet been verified with a reference file or installation. The supplied Applanix note does not explicitly specify byte order; little-endian is the default assumption, with big-endian available in output settings.

## Run locally

Use Node.js 22 or newer. The application itself has no runtime dependencies.

```sh
npm start
```

Open **http://127.0.0.1:4173**. Use **Try a synthetic capture** to exercise the complete workflow without your own data.

1. Select an uncompressed `.pcap` file.
2. Select the recorded sensor's 32-channel angle correction CSV and firing correction CSV. Standard XT32M2X firing offsets from the manual are also available.
3. Choose the sensor's recorded time scale and LQC version.
4. Select **Convert & save LQC**, choose an output location, and keep the tab open.
5. Save the companion JSON report, which records calibration fingerprints, GPS week, timing settings, point counts, and packet gaps.

Desktop **Chrome and Edge** support progressive saving to disk. Other browsers use an in-memory download limited to **16 MiB input / 128 MiB output**. Large files need sufficient free disk space; output can be much larger than input. A browser may also need temporary disk space while committing a file.

Once the app reports that it is cached for offline use, conversion works with the network disconnected. The service worker caches application assets only. Selected captures and calibration files never enter that cache. The page blocks application network connections with a Content Security Policy and loads no third-party scripts, fonts, or analytics.

## GitHub Pages

The intended repository is `xmfcx/pcap-to-lqc`, with site URL **https://xmfcx.github.io/pcap-to-lqc/** after deployment.

In the repository's **Settings → Pages**, select **GitHub Actions** as the source. The included workflow tests the converter and browser behavior, builds the site, and deploys pushes to `main`. Pull requests run the checks without deploying.

```sh
npm run build
```

Only `site/` is copied to `dist/` and published. Local captures, reference PDFs, sensor calibration CSVs, tests, and command-line tools are excluded from the deployed site. Relative asset paths and service-worker scope support GitHub Pages project URLs.

## Supported conversion

- Classic PCAP 2.4, either byte order, microsecond or nanosecond capture timestamps.
- Ethernet, optional VLAN tags, IPv4, and unfragmented UDP.
- XT32M2X protocol 6.1: 32 channels, six blocks, 5 mm range units.
- First, last, strongest, dual, and triple return modes listed in the sensor manual.
- Sensor-frame XYZ with angle calibration and firing-time azimuth correction.
- Per-point firing timestamps converted to GPS seconds of week; UTC, GPS, TAI, or an explicit GPS-minus-sensor offset.
- LQC 1.0 (24-byte records) or 1.1 (25-byte records), with a 12-byte ASCII header.

PCAPNG, ZIP input, other LiDAR models, fragmented UDP, mixed sensor sources, truncated packets, out-of-order packets, GPS week crossings, and packets straddling UTC leap-second insertion are rejected with an explanation. Split or export captures into the supported form first. UTC leap-second history is valid through 2026; later dates require a verified custom offset or an updated table.

Distinct recorded ranges for each firing/channel are sorted nearest first and numbered in that order. Equal raw ranges are merged, retaining the greatest intensity. These are the **recorded returns**, not a reconstruction of all physical echoes. Zero ranges are skipped. Raw 0–255 intensity is preserved; classification and scan flags are zero. LQC 1.1 uses laser IDs 0–31 with PCDA participation enabled.

No optical-center, spot, mounting, trajectory, or georeferencing corrections are applied. Verify the sensor frame/origin and mounting configuration for your POSPac workflow. Correct time-scale selection does not establish that the sensor was synchronized to the navigation system.

## Implementation and tests

The first version uses a small JavaScript decoder based on the supplied manual, rather than porting the entire C++ Hesai SDK. Browser and command-line paths share the same conversion engine. A streaming PCAP reader and approximately 1 MiB output batches keep memory bounded; the worker waits for each write before sending another batch. WebAssembly can be introduced later if profiling justifies it.

```text
site/lib/     PCAP reader, calibration, XT32M2X decoding, GPS time, LQC writer
site/         Browser interface, worker, and offline application cache
scripts/      Local server, static build, and command-line converter
test/        Binary/geometry/time tests and browser integration tests
.github/      GitHub Pages test-and-deploy workflow
```

```sh
npm test
npm ci
npx playwright install chromium
npm run test:browser
```

For an installed Chrome, set `BROWSER_PATH=/path/to/chrome` when running browser tests. Browser tests cover offline conversion, byte-for-byte agreement with the native engine, a real browser writable stream, cancellation, disk errors, invalid input, and mobile layout. The save picker is substituted during automation; the writable-stream test uses browser-private storage.

The supplied 3.15 GiB sample was fully decoded with UTC selected as a test assumption:

| Result | Value |
| --- | --- |
| Input packets | 3,851,613 |
| Output points | 252,319,638 |
| LQC 1.1 bytes | 6,307,990,962 (about 5.87 GiB) |
| Missing packet sequence numbers | 0 |
| GPS week | 2106 |

The full capture also completed offline in Chrome, writing the expected 6,307,990,962-byte file through a real browser writable stream.

An independent Python reference also checked every field of 702,176 output records from the first 10,000 real packets. These checks validate implementation consistency, not POSPac acceptance or synchronization of the original recording.

## Command-line conversion

```sh
npm run convert -- \
  data/XT32M2X/pcap/XT32M2X_first_last_strongest_urban.pcap \
  docs/XT32M2X_Angle_Correction_File-1.csv \
  docs/XT32M2X_Firetime_Correction_File.csv.csv \
  /tmp/capture.lqc --time-scale utc
```

Use the actual recorded time scale. Additional options are `--version 1.0|1.1`, `--byte-order little|big`, `--rotation 1|-1`, and `--time-scale custom --offset SECONDS`. `--validate-only` processes and hashes the complete output without saving it. Existing output files are never overwritten; successful conversion creates a companion `.conversion.json` report.

## Local reference material

These supplied files remain local and are ignored by Git:

| Path | Purpose |
| --- | --- |
| `data/XT32M2X/pcap/*.pcap` and `*.zip` | Real capture and its archive. |
| `docs/XT32M2X_User_Manual_X03-en-260710.pdf` | Packet layout (§3.1), coordinates (§3.1.4), and timing (Appendix B). |
| `docs/XT32M2X_Angle_Correction_File-1.csv` | Sample sensor's 32-channel angle calibration. |
| `docs/XT32M2X_Firetime_Correction_File.csv.csv` | Firing offsets, in microseconds. |
| `docs/Tech Note LiDAR QC L5D and LQC Format.pdf` | LQC 1.0/1.1 field layouts and LAS-style flags. |

The sample's PCAP clock dates to 1970, while its embedded sensor calendar dates to 2020. PCAP capture time is therefore shown for inspection but is never used for point timing. No matching Applanix trajectory is included.

References: [Hesai SDK](https://github.com/HesaiTechnology/HesaiLidar_SDK_2.0), [Applanix LiDAR QC FAQ](https://www.applanix.com/downloads/products/FAQs/FAQs_LiDAR-QC-Tools.pdf), [IERS Bulletin C 72](https://datacenter.iers.org/data/html/bulletinc-072.html), [browser file access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
