#!/bin/bash

while true; do
  echo "Starting bot..."
  node main.js
  echo "Bot crashed! Restarting in 5 seconds..."
  sleep 5
done

