#!/usr/bin/env bash
# Build the Expo web app and publish it to boxersolutionspestcontrol.com/app on EC2.
set -euo pipefail
cd "$(dirname "$0")/../mobile"
EXPO_PUBLIC_API_URL=https://api.boxersolutionspestcontrol.com npx expo export --platform web --output-dir dist-web
KEY="${SF_EC2_KEY:-/Users/lezdev/Downloads/Boxer EC2 Key.pem}"
HOST="${SF_EC2_HOST:-ec2-user@18.220.241.84}"
rsync -az --delete -e "ssh -i \"$KEY\" -o BatchMode=yes" dist-web/ "$HOST:/tmp/boxer-web/"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'sudo mkdir -p /var/www/boxer-app && sudo rsync -a --delete /tmp/boxer-web/ /var/www/boxer-app/ && sudo chown -R nginx:nginx /var/www/boxer-app 2>/dev/null || true; sudo nginx -t && sudo systemctl reload nginx && echo "web app published"'
