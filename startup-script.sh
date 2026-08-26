#!/bin/sh
set -e

# Fetch once, parse many
META="$(curl -s "$ECS_CONTAINER_METADATA_URI_V4")"

export TASK_ARN="$(echo "$META" | jq -r '.Labels["com.amazonaws.ecs.task-arn"]')"
export TASK_ID="${TASK_ARN##*/}"
export TASK_IP="$(echo "$META" | jq -r '.Networks[0].IPv4Addresses[0]')"
export TASK_DNS="$(echo "$META" | jq -r '.Networks[0].PrivateDNSName // empty')"

# Optional: log once
echo "TASK_ID=$TASK_ID TASK_IP=$TASK_IP TASK_DNS=$TASK_DNS"

# Hand off to your app in the same process
exec "$@"
