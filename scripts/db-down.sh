#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/db-common.sh"
# This project owns only gxdb-* containers/network/volume; nothing else on the machine is touched.
gx_compose down --volumes
