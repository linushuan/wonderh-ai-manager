#!/bin/bash
HOST_NAME="com.wonderh.ai.manager"
ABS_PATH=$(cd "$(dirname "$0")" && pwd)
SCRIPT_PATH="$ABS_PATH/native-host/wonderh_host.py"
chmod +x "$SCRIPT_PATH"

MANIFEST_JSON='{
  "name": "'"$HOST_NAME"'",
  "description": "REXOW Native Host",
  "path": "'"$SCRIPT_PATH"'",
  "type": "stdio",
  "allowed_extensions": ["wonderh-ai@manager.local"]
}'

# Firefox & Chrome Paths
mkdir -p "$HOME/.mozilla/native-messaging-hosts"
echo "$MANIFEST_JSON" > "$HOME/.mozilla/native-messaging-hosts/$HOST_NAME.json"
mkdir -p "$HOME/.config/google-chrome/NativeMessagingHosts"
echo "$MANIFEST_JSON" > "$HOME/.config/google-chrome/NativeMessagingHosts/$HOST_NAME.json"

echo "✅ REXOW Native Host registered at: $SCRIPT_PATH"
