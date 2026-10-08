#!/bin/bash

# Kill all processes running on ports 4000, 3000, and 3001

PORTS=(5173 5174 5175 8000)

for PORT in "${PORTS[@]}"; do
  echo "Checking port $PORT..."
  if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "  Killing process on port $PORT..."
    lsof -ti:$PORT | xargs kill -9 2>/dev/null
    echo "  ✓ Port $PORT is now free"
  else
    echo "  ✓ Port $PORT is already free"
  fi
done

echo "Done!"
