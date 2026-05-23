#!/bin/sh

set -eu

# The web UI cannot be launched locally. conv-agent runs unauthenticated locally
# and the deployed dev backend sits behind Cloudflare Access, which logs out via a
# team-domain redirect tied to the API's host. A local UI pointed at the dev API
# would not be able to complete a clean logout against its own origin. Deploy the
# web UI to dev (./deployment/dev/deploy-web-dev.sh deploy) and use it there.
echo "Local launch of the web UI is not supported." >&2
echo "Use the deployed dev UI at https://thoth-dev.bots-ns.com instead." >&2
exit 1
