#!/bin/bash
message="${1:-changes}"
git add . && git commit -m "$message" && git push
