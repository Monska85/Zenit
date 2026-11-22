# Certificate bundle

The firmware checks every HTTPS server it reads from against the roots in `x509_crt_bundle.bin`: Espressif's common certificate bundle, the 43 roots listed in `cmn_crt_authorities.csv` of esp-idf, which cover nearly every public HTTPS site. It replaces the full bundle of about 150 roots that the framework embeds (68,471 bytes) with 17,924 bytes, and saves 50,547 bytes of the firmware ([ADR 0006](../docs/adr/0006-firmware-size.md)). `src/crt_bundle.S` embeds the file under the two symbols the framework's bundle code reads, so the linker never takes the full bundle.

GitHub Pages, which serves the update manifests and their files, chains up to ISRG Root X1, which is in the bundle. `github-pages-chain.pem` holds the chain GitHub Pages sent when the bundle was made; `tools/test_crt_bundle.py`, run by `just check`, checks offline that this chain verifies against a root of the bundle. The roots are the Mozilla CA list, under the MPL-2.0 (`LICENSES/firmware/MPL-2.0.txt`).

## Regenerating the bundle

`python3 tools/crt_bundle.py regenerate` downloads three files from esp-idf at the tag the framework is built from (`v5.5.5`, from the `versions.txt` of the Arduino-ESP32 3.3.12 libraries), checks their SHA-256, and runs Espressif's generator on them:

- `gen_crt_bundle.py`, the generator,
- `cacrt_all.pem`, the Mozilla list of roots,
- `cmn_crt_authorities.csv`, the common roots to keep.

It needs the `cryptography` package of `requirements-ci.txt`. The output is reproducible: the same inputs give the same file, byte for byte. It prints the SHA-256 of the new file, which goes into `BUNDLE_SHA256` in the same script.

Two checks keep the committed file the generator's output:

- `tools/test_crt_bundle.py`, part of `just check` and of the required `check` job of CI, compares the file with `BUNDLE_SHA256` offline, so a file changed alone fails.
- `python3 tools/crt_bundle.py check` makes the bundle again into a temporary folder and fails unless it is the committed file, byte for byte. It needs the network, so it runs in the `certificates` job of CI, which reports a mismatch but is not a required check; a failure there is resolved before merging.

Regenerate it when:

- Arduino-ESP32 moves to another esp-idf release: set `IDF_TAG` in `tools/crt_bundle.py` to that release's tag, download the three files from it (the address pattern is `SOURCE_URL` in the script), put their SHA-256 (`sha256sum`, or `shasum -a 256`) in `SOURCES`, then run the command and set `BUNDLE_SHA256`. When the number of roots or the size of the bundle changes, update the count in `tools/test_crt_bundle.py` and the numbers in this file and in `docs/board/wifi-and-updates-v1.md`.
- GitHub Pages moves to another certificate chain, which boards show as `tls_error` (the checks read the saved chain and the pinned esp-idf files, so they cannot notice the move by themselves): save the chain GitHub Pages now sends (`openssl s_client -connect monska85.github.io:443 -servername monska85.github.io -showcerts`, the certificates only) in `github-pages-chain.pem` and run the tests, which tell whether its root is in the bundle. If it is not, the list itself has to change, which needs a new decision record.
